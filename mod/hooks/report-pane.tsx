import { answerStates, discussDecision, inputUnavailableKey, selectAnswer, sendAnswer } from './decision-input'
import { CHOSEN } from './chosen-style'
import { atom, read, update } from 'claude-code'
import type { On, SessionUsage, ButtonProps, ElementChildren, RenderElement } from 'claude-code'
import { placeCard, OPEN_LABEL, clip } from './layout'
import { reportLines } from './report-layout'
import { decisionVersion, reportKey } from './report'
import { enrichmentKey } from './enrichment'
import type { EnrichedSnapshot } from './enrichment'
import type { ContextReport } from './report'
import { cells, factsKey, sessionRows } from './session-facts'
import type { SessionFacts } from './session-facts'
import { paneWorkers, reducedMotion, workerLines } from './workers'
import { configKey } from './templates'
import type { Template } from './templates'

export type ReportView = { shown: string | null; expanded: number[]; decision?: string | null }
export const reportViews = atom({ plugin: 'whatsup', key: 'reportViews' } as const, {} as Record<string, ReportView>)

export function registerReportPane(on: On, recorded: boolean) {
  if (recorded) return
  const desktop = new Map<string, { revision: number; input: string; sequence?: number; actions: Map<string, () => unknown> }>()
  let revision = 0
  on('ui.message', { component: 'Pane', requestId: 'session-status' }, async ($, e, next) => {
    if (!['./desktop-pane.tsx', 'hooks/desktop-pane.tsx'].includes(e.module) || e.surface !== 'desktop' || !e.data || typeof e.data !== 'object') return next(e)
    const session = await $.session.id(), active = desktop.get(session)
    const data = e.data as { action?: string; revision?: number; sequence?: number; dismiss?: boolean }
    if (active && data.revision === active.revision && Number.isSafeInteger(data.sequence) && data.sequence! > (active.sequence ?? 0)) {
      active.sequence = data.sequence
      if (typeof data.action === 'string') await active.actions.get(data.action)?.()
      else if (data.dismiss === true) await update($, reportViews, all => ({ ...all, [session]: { ...(all[session] ?? { expanded: [] }), shown: null } }))
    }
    return {}
  })
  on('ui.message', { component: 'Pane', requestId: 'session-status' }, async ($, e, next) => {
    if (!['./dismiss.tsx', 'hooks/dismiss.tsx'].includes(e.module) || !(e.data && typeof e.data === 'object' && 'dismiss' in e.data && e.data.dismiss === true)) return next(e)
    const session = await $.session.id()
    await update($, reportViews, all => ({ ...all, [session]: { ...(all[session] ?? { expanded: [] }), shown: null } }))
    return {}
  })
  on('ui.render', { component: 'Pane', requestId: 'session-status' }, async ($, e) => {
    const elements = $.ui.resolve(e)
    const { Box, Text, Button } = elements
    if (!('Client' in elements)) return <Text>whatsup requires a terminal or desktop pane.</Text>
    const { Client } = elements
    const session = await $.session.id()
    const report = (await $.store.get(reportKey(session)) ?? null) as ContextReport | null
    const view = (await read($, reportViews))[session] ?? { shown: null, expanded: [] }
    const columns = Math.max(1, e.props.bodyColumns)
    const rows = Math.max(1, e.props.scroll.bodyRows)
    const enriched = await $.store.get(enrichmentKey(session)) as EnrichedSnapshot | undefined
    const current = enriched?.input === JSON.stringify(report) ? enriched : undefined
    const config = await $.store.get(configKey(session)) as Template | undefined
    const now = await $.clock.now()
    const facts = await $.store.get(factsKey(session)) as SessionFacts | undefined
    let usage: SessionUsage | undefined
    try { usage = await $.session.usage() } catch { /* Unknown measurements render as unavailable. */ }
    const sessionBox = sessionRows(report?.scope ?? 'No scope yet', session, facts ?? { started: now, folder: await $.session.cwd() }, usage, now, columns, config?.session.density ?? 'compact', current?.off_reason)
    const workers = await paneWorkers($, now)
    const lines = [...reportLines(current?.report ?? report, columns, view.expanded, undefined, config, view.decision, await answerStates($, session), !await $.store.get(inputUnavailableKey(session)), e.surface === 'desktop').filter(line => line.key !== 'scope'), ...workerLines(workers, columns, now, config?.motion === false || await reducedMotion($), config?.status_emoji, e.surface === 'desktop')]
    const rowKeys = ['hide-session-top', 'hide-session-top-space', ...sessionBox.map(row => `session-row-${row.key}`), 'hide-session-bottom',
      ...lines.map(line => (line.item || line.decision || line.action) ? `line-${line.key}` : `hide-${line.key}`)]
    const overflowing = rows > 1 && rowKeys.length > rows
    const change = (next: (current: ReportView) => ReportView) => update($, reportViews, all => ({ ...all, [session]: next(all[session] ?? { shown: null, expanded: [] }) }))
    const hide = () => change(current => ({ ...current, shown: null }))
    const show = (key: string) => change(current => ({ ...current, shown: current.shown === key ? null : key }))
    const expand = (index: number) => change(current => ({ shown: null, expanded: current.expanded.includes(index) ? current.expanded.filter(n => n !== index) : [...current.expanded, index] }))
    const expandDecision = async (identity: string, version: string) => {
      const latest = await $.store.get(reportKey(session)) as ContextReport | undefined
      if (!latest?.decisions?.some(decision => decision.identity === identity && decisionVersion(decision) === version)) return
      await change(current => ({ ...current, shown: null, decision: current.decision === version ? null : version }))
    }
    const quiet = (key: string, parts: { text: string; color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; underline?: boolean }[]) => <Client key={key} module="./dismiss.tsx" width={parts.reduce((n, p) => n + cells(p.text), 0)} height={1} props={{ parts: parts.map(part => Object.fromEntries(Object.entries(part).filter(([, value]) => value !== undefined))) }} />
    const blank = (key: string, text: string, unavailable = false, color = CHOSEN.text, backgroundColor?: string) => quiet(key, [{ text, dimColor: unavailable, color: unavailable ? CHOSEN.grey : color, ...(backgroundColor ? { backgroundColor } : {}) }])
    const shownRow = lines.findIndex(line => line.item?.key === view.shown)
    const shown = shownRow >= 0 ? lines[shownRow]!.item : undefined
    const card = () => {
      if (!shown) return null
      // Text-only cards have no action row; their first line is the supplied title.
      const box = placeCard(shown.page ? OPEN_LABEL : shown.details[0] ?? '', shown.page ? shown.details : shown.details.slice(1), shownRow + sessionBox.length + 3, e.props.scroll.offset, overflowing ? rows - 1 : rows, columns)
      const inner = box.width - (box.bordered ? 4 : 0)
      const left = box.bordered ? '│ ' : ''
      const right = box.bordered ? ' │' : ''
      const open = async () => {
        try {
          const result = await $.process.run(['open', '--', shown.page!])
          if (result.exitCode !== 0) $.ui.toast(`Couldn't open ${shown.page}`)
        } catch { $.ui.toast(`Couldn't open ${shown.page}`) }
      }
      return <Box key={`card-${shown.key}`} position="absolute" top={shownRow + sessionBox.length + 3 + box.top} left={0} width={box.width} flexDirection="column">
        {box.bordered && blank(`hide-card-${shown.key}-top`, '╭' + '─'.repeat(box.width - 2) + '╮')}
        {box.lines.map((line, index) => index === 0 && shown.page
          ? <Box key="head" flexDirection="row">
              {blank(`hide-card-${shown.key}-before`, left)}
              <Button key={`open-${shown.key}`} label={line} plain onPress={open}>{line}</Button>
              {blank(`hide-card-${shown.key}-beside`, ' '.repeat(Math.max(0, inner - cells(line))) + right)}
            </Box>
          : blank(`hide-card-${shown.key}-${index}`, left + line + ' '.repeat(Math.max(0, inner - cells(line))) + right))}
        {box.bordered && blank(`hide-card-${shown.key}-bottom`, '╰' + '─'.repeat(box.width - 2) + '╯')}
      </Box>
    }
    const activate = async (action: string, target: string) => {
      await hide()
      try {
        const result = action.startsWith('copy-')
          ? await $.process.run(['pbcopy'], { stdin: target })
          : await $.process.run(['open', '--', target])
        if (result.exitCode !== 0) $.ui.toast(`Couldn't ${action.startsWith('copy-') ? 'copy' : 'open'} ${target}`)
      } catch { $.ui.toast(`Couldn't ${action.startsWith('copy-') ? 'copy' : 'open'} ${target}`) }
    }
    const actionKeys = new Set<string>()
    const inner = Math.max(1, columns - 4)
    const offset = e.props.scroll.offset
    const page = Math.max(1, rows - 1)
    const more = offset + page < rowKeys.length
    const scrollPage = async (direction: number) => {
      await hide()
      const index = Math.max(0, Math.min(rowKeys.length - 1, offset + direction * page))
      await $.ui.scroll({ in: 'session-status', to: { key: rowKeys[index]! }, block: 'start' })
    }
    const navigation = (key: string, label: string, hotkey: string, direction: number) => {
      const width = offset > 0 && more ? Math.floor(columns / 2) : columns
      const shortcut = columns >= 24 ? hotkey : undefined
      const gap = key === 'pane-previous' && more && columns >= 24 ? '  ' : ''
      const title = clip(label, Math.max(1, width - (shortcut ? 3 : 0) - gap.length)) + gap
      return <Button key={key} label={title} plain hotkey={shortcut} onPress={() => scrollPage(direction)}><Text backgroundColor={CHOSEN.ink}>{title}</Text></Button>
    }
    if (e.surface === 'desktop') {
      const actions = new Map<string, () => unknown>()
      const NativeButton = ({ onPress, children, ...props }: Omit<ButtonProps, 'onPress'> & ElementChildren & { onPress: () => unknown }) => {
        const key = props.key ?? props.label!
        actions.set(key, onPress)
        return { type: 'Button', props: { ...props, key }, children: Array.isArray(children) ? children.flat(Infinity) : children === undefined ? [] : [children] } as RenderElement
      }
      // Keep semantic rows and their handlers; the surface owns frame geometry.
      const clean = (text: string) => text.replace(/[─│┌┐└┘╭╮╰╯]/g, '').replace(/ {2,}/g, ' ').trim()
      const nativeText = (key: string, text: string, color = CHOSEN.text, dimColor = false, bold = false) =>
        <Text key={key} color={color} dimColor={dimColor} bold={bold}>{clean(text)}</Text>
      const nativeParts = (line: typeof lines[number]) => line.parts.map((part, i) =>
        <Text key={String(i)} color={part.color ?? CHOSEN.text} bold={part.bold} dimColor={part.dim || line.dim || line.unavailable} underline={part.underline}>{(i && !line.key.endsWith('-bar') && clean(part.text) ? ' ' : '') + clean(part.text)}</Text>)
      const action = (line: typeof lines[number]) => {
        const a = line.action!
        return a.kind === 'discuss' ? discussDecision($, session, a.identity, a.version)
          : a.kind === 'send' ? sendAnswer($, session, a.identity, a.version, a.option!)
          : selectAnswer($, session, a.identity, a.version, a.kind === 'clear' ? undefined : a.option)
      }
      const nativeCard = (line: typeof lines[number]) => {
        return shown ? <Box key={`card-${shown.key}`} flexDirection="column" borderStyle="round" borderColor={line.accent ?? CHOSEN.text} backgroundColor={line.background ?? CHOSEN.ink} paddingX={1}>
          {shown.page && <NativeButton key={`open-${shown.key}`} label={OPEN_LABEL} plain onPress={() => activate('open', shown.page!)}>{OPEN_LABEL}</NativeButton>}
          {shown.details.map((detail, i) => nativeText(`card-detail-${i}`, detail))}
          <NativeButton key={`close-${shown.key}`} label="Back" plain onPress={hide}>Back</NativeButton>
        </Box> : null
      }
      const nativeRow = (line: typeof lines[number]) => {
        const key = (line.item || line.decision || line.action) ? `line-${line.key}` : `hide-${line.key}`
        if (!line.item && !line.decision && !line.action && line.parts.every(part => !clean(part.text))) {
          return <Box key={key} height={1} />
        }
        const separated = /^section-\d+-(description|kind|item-0)$/.test(line.key)
        let content = nativeParts(line)
        const workerIndex = /^worker-(\d+)$/.exec(line.key)?.[1]
        if (workerIndex !== undefined) content = [nativeText('title', `▾ ${workers[Number(workerIndex)]!.role} · ${workers[Number(workerIndex)]!.name}`, line.accent, line.dim, true)]
        if (line.decision && columns >= 24) content = [nativeText('title', `${view.decision === line.decision.version ? '▾' : '▸'} Decision ${Number(line.key.split('-')[1]) + 1}`, line.accent, false, true)]
        let body
        if (line.action) {
          const a = line.action
          const base = a.kind === 'select' ? `select-decision-${line.key.split('-')[1]}-${line.key.split('-')[3]}` : `${a.kind}-decision-${line.key.split('-')[1]}`
          const buttonKey = actionKeys.has(base) ? `${base}-${line.key}` : base
          actionKeys.add(base)
          body = <NativeButton key={buttonKey} label={clean(line.parts.map(p => p.text).join(''))} plain hotkey={a.hotkey} onPress={() => action(line)}>{content}</NativeButton>
        } else if (line.decision) body = <NativeButton key={`expand-${line.key}`} label={clean(line.parts.map(p => p.text).join(''))} plain hotkey={line.decision.hotkey} onPress={() => expandDecision(line.decision!.identity, line.decision!.version)}>{content}</NativeButton>
        else if (line.item) body = <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {line.expand !== undefined && <NativeButton key={`expand-${line.key}`} label={line.marker!.trim()} plain onPress={() => expand(line.expand!)}>{line.marker!.trim()}</NativeButton>}
          <NativeButton key={`show-${line.item.key}`} label={clean(line.parts.map(p => p.text).join(''))} plain onPress={() => show(line.item!.key)}>{content}</NativeButton>
        </Box>
        else body = <Box flexDirection="row" flexWrap="wrap" gap={line.key.endsWith('-bar') ? 0 : 1}>{content}</Box>
        const badge = workerIndex !== undefined ? workers[Number(workerIndex)]!.model ?? '—' : line.badge
        const row = <Box flexDirection="row" flexWrap="wrap" justifyContent="space-between" gap={1}>
          {line.item ? <Box key={line.badge ? `native-content-${line.key}` : `hide-${line.key}-rest`}>{body}</Box> : body}
          {badge ? <Text key={`hide-${line.key}-rest`} bold dimColor={line.dim || line.unavailable} color={workerIndex !== undefined ? CHOSEN.muted : line.dim || line.unavailable ? CHOSEN.grey : CHOSEN.ink} backgroundColor={workerIndex !== undefined || line.dim || line.unavailable ? CHOSEN.badgeBackground : line.accent}>{clean(badge)}</Text>
            : line.decision ? nativeText(`hide-${line.key}-rest`, line.suffix ?? '', line.accent)
            : null}
        </Box>
        return <Box key={key} flexDirection="column" {...(separated ? { marginTop: 1 } : {})}>{row}{line.item && shown?.key === line.item.key && nativeCard(line)}</Box>
      }
      const groups: typeof lines[] = []
      for (const line of lines) {
        if (/^(decision|section|worker)-\d+$/.test(line.key)) groups.push([line])
        else if (/^(decision|section|worker)-\d+-/.test(line.key)) groups[groups.length - 1]!.push(line)
        else groups.push([line])
      }
      const renderInput = JSON.stringify([columns, rows, sessionBox, lines, report?.scope, workers.map(w => [w.name, w.model]), view.shown])
      const previous = desktop.get(session)
      const tree = <Box flexDirection="column" width="100%" minHeight={rows} paddingBottom={1} gap={1}>
        <Box key="desktop-session" flexDirection="column" borderStyle="single" borderColor={CHOSEN.session} backgroundColor={CHOSEN.sessionTint} paddingX={1}>
          {nativeText('desktop-session-title', 'Session', CHOSEN.session, false, true)}
          {sessionBox.map(row => <Box key={`session-row-${row.key}`} flexDirection="row" flexWrap="wrap" gap={1}>
            {row.parts.map((part, i) => {
              if (!part.action) return nativeText(`hide-session-${row.key}-${i}`, row.key === 'scope' ? report?.scope ?? 'No scope yet' : part.text, CHOSEN.text, row.dim)
              const base = `session-${part.action}`
              const key = actionKeys.has(base) ? `${base}-${row.key}-${i}` : base
              actionKeys.add(base)
              return <NativeButton key={key} label={clean(part.text)} plain onPress={() => activate(part.action!, part.target!)}><Text color={part.accent ? CHOSEN.session : CHOSEN.text} bold={part.accent} dimColor={row.dim && !part.accent}>{clean(part.text)}</Text></NativeButton>
            })}
          </Box>)}
        </Box>
        {groups.map(group => {
          const first = group[0]!
          const boxed = /^(decision|section|worker)-\d+$/.test(first.key)
          return boxed ? <Box key={`desktop-${first.key}`} flexDirection="column" borderStyle="single" borderColor={first.accent ?? CHOSEN.text} backgroundColor={group.find(line => line.background)?.background ?? CHOSEN.ink} paddingX={1}>
            {group.filter(line => !line.key.endsWith('-bottom')).map(nativeRow)}
          </Box> : nativeRow(first)
        })}
      </Box>
      const currentRevision = previous?.input === renderInput ? previous.revision : ++revision
      desktop.set(session, { revision: currentRevision, input: renderInput, actions, ...(previous?.revision === currentRevision ? { sequence: previous.sequence } : {}) })
      return <Client key="desktop-pane" module="./desktop-pane.tsx" width="100%" props={JSON.parse(JSON.stringify({ tree, revision: currentRevision, sequence: desktop.get(session)!.sequence ?? 0 }))} />
    }
    return <Box flexDirection="column" width={columns} minHeight={rows}>
      {quiet('hide-session-top', [{ text: '┌─ ', color: CHOSEN.session }, { text: 'Session', color: CHOSEN.session, bold: true }, { text: ' ' + '─'.repeat(Math.max(0, columns - 12)) + '┐', color: CHOSEN.session }])}
      {quiet('hide-session-top-space', [{ text: '│', color: CHOSEN.session }, { text: ' '.repeat(Math.max(0, columns - 2)), backgroundColor: CHOSEN.sessionTint }, { text: '│', color: CHOSEN.session }])}
      {sessionBox.map(row => <Box key={`session-row-${row.key}`} flexDirection="row">
        {quiet(`hide-session-${row.key}-before`, [{ text: '│', color: CHOSEN.session }, { text: ' ', backgroundColor: CHOSEN.sessionTint }])}
        {row.parts.map((part, index) => {
          let key = row.key === 'scope' ? 'hide-scope' : `hide-session-${row.key}-${index}`
          if (part.action) {
            const base = `session-${part.action}`
            key = actionKeys.has(base) ? `${base}-${row.key}-${index}` : base
            actionKeys.add(base)
          }
          if (!part.action) return quiet(key, [{ text: part.text, dimColor: row.dim, color: CHOSEN.text, backgroundColor: CHOSEN.sessionTint }])
          return <Button key={key} label={part.text} plain onPress={part.action ? () => activate(part.action!, part.target!) : hide}>
            <Text bold={part.accent} dimColor={row.dim && !part.accent} color={part.accent ? CHOSEN.session : CHOSEN.text} backgroundColor={CHOSEN.sessionTint}>{part.text}</Text>
          </Button>
        })}
        {quiet(`hide-session-${row.key}-after`, [{ text: ' '.repeat(Math.max(0, inner - row.parts.reduce((n, part) => n + cells(part.text), 0)) + 1), backgroundColor: CHOSEN.sessionTint }, { text: '│', color: CHOSEN.session }])}
      </Box>)}
      {blank('hide-session-bottom', '└' + '─'.repeat(Math.max(0, columns - 2)) + '┘', false, CHOSEN.session)}
      {lines.map(line => {
        const color = line.unavailable ? CHOSEN.grey : line.accent ?? CHOSEN.text
        const dimColor = line.unavailable || line.dim
        const parts = line.parts.map(part => ({ text: part.text, color: part.color ?? CHOSEN.text, bold: part.bold, dimColor: part.dim || dimColor, underline: part.underline, backgroundColor: line.background }))
        const edge = (text: string) => ({ text, color, dimColor, backgroundColor: line.background })
        const suffix = () => {
          if (!line.badge) return [edge(line.suffix ?? '')]
          const [before, after] = line.suffix!.split(`[${line.badge}]`)
          return [edge(before!), { text: ` ${line.badge} `, backgroundColor: line.key.startsWith('worker-') || line.unavailable || line.dim ? CHOSEN.badgeBackground : color, color: line.key.startsWith('worker-') ? CHOSEN.muted : line.unavailable || line.dim ? CHOSEN.grey : CHOSEN.ink, dimColor, bold: true }, edge(after!)]
        }
        if (line.action) {
          const a = line.action
          const base = a.kind === 'select' ? `select-decision-${line.key.split('-')[1]}-${line.key.split('-')[3]}` : `${a.kind}-decision-${line.key.split('-')[1]}`
          const key = actionKeys.has(base) ? `${base}-${line.key}` : base
          actionKeys.add(base)
          return <Box key={`line-${line.key}`} flexDirection="row">
            {quiet(`hide-${line.key}-before`, [edge(line.prefix ?? '')])}
            <Button key={key} label={line.parts.map(p => p.text).join('')} plain hotkey={a.hotkey} onPress={() => a.kind === 'discuss' ? discussDecision($, session, a.identity, a.version) : a.kind === 'send' ? sendAnswer($, session, a.identity, a.version, a.option!) : selectAnswer($, session, a.identity, a.version, a.kind === 'clear' ? undefined : a.option)}>{parts.map(({ text, ...style }, i) => <Text key={String(i)} {...style}>{text}</Text>)}</Button>
            {quiet(`hide-${line.key}-rest`, suffix())}
          </Box>
        }
        if (line.decision) return <Box key={`line-${line.key}`} flexDirection="row">
          {quiet(`hide-${line.key}-before`, [edge(line.prefix ?? '')])}
          <Button key={`expand-${line.key}`} label={line.parts.map(p => p.text).join('')} plain hotkey={line.decision.hotkey} onPress={() => expandDecision(line.decision!.identity, line.decision!.version)}>{parts.map(({ text, ...style }, i) => <Text key={String(i)} {...style}>{text}</Text>)}</Button>
          {quiet(`hide-${line.key}-rest`, suffix())}
        </Box>
        if (line.item) return <Box key={`line-${line.key}`} flexDirection="row">
          {line.prefix && quiet(`hide-${line.key}-before`, [edge(line.prefix)])}
          {line.expand !== undefined && <Button key={`expand-${line.key}`} label={line.marker!} plain onPress={() => expand(line.expand!)}><Text dimColor={dimColor} color={color}>{line.marker}</Text></Button>}
          <Button key={`show-${line.item.key}`} label={line.parts.map(p => p.text).join('')} plain onPress={() => show(line.item!.key)}>{parts.map(({ text, ...style }, i) => <Text key={String(i)} {...style}>{text}</Text>)}</Button>
          {quiet(`hide-${line.key}-rest`, suffix())}
        </Box>
        return quiet(`hide-${line.key}`, [...(line.prefix ? [edge(line.prefix)] : []), ...parts, ...suffix(), edge(' '.repeat(Math.max(0, columns - cells(line.prefix ?? '') - line.parts.reduce((n, p) => n + cells(p.text), 0) - cells(line.suffix ?? ''))))])
      })}
      {Array.from({ length: Math.max(0, rows - lines.length - sessionBox.length - 3) }, (_, index) => blank(`hide-below-${index}`, ' '.repeat(columns)))}
      {/* One trailing row lets the final content row clear the pinned controls. */}
      {overflowing && blank('hide-overflow-end', ' '.repeat(columns))}
      {card()}
      {overflowing && <Box key="overflow-controls" position="absolute" top={offset + rows - 1} left={0} width={columns} height={1} flexDirection="row" backgroundColor={CHOSEN.ink}>
        {offset > 0 && navigation('pane-previous', '↑ Back', 'p', -1)}
        {more && navigation('pane-next', 'More ↓', 'n', 1)}
      </Box>}
    </Box>
  })
}
