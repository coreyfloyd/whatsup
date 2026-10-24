import { answerStates, discussDecision, inputUnavailableKey, selectAnswer, sendAnswer } from './decision-input'
import { CHOSEN } from './chosen-style'
import { atom, read, update } from 'claude-code'
import type { On, SessionUsage } from 'claude-code'
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
    const lines = [...reportLines(current?.report ?? report, columns, view.expanded, undefined, config, view.decision, await answerStates($, session), !await $.store.get(inputUnavailableKey(session))).filter(line => line.key !== 'scope'), ...workerLines(await paneWorkers($, now), columns, now, config?.motion === false || await reducedMotion($), config?.status_emoji)]
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
    return <Box flexDirection="column" width={columns} minHeight={rows}>
      {quiet('hide-session-top', [{ text: '┌─ ', color: CHOSEN.session }, { text: 'Session', color: CHOSEN.session, bold: true }, { text: ' ' + '─'.repeat(Math.max(0, columns - 12)) + '┐', color: CHOSEN.session }])}
      {quiet('hide-session-top-space', [{ text: '│', color: CHOSEN.session }, { text: ' '.repeat(Math.max(0, columns - 2)), backgroundColor: '#2f2a22' }, { text: '│', color: CHOSEN.session }])}
      {sessionBox.map(row => <Box key={`session-row-${row.key}`} flexDirection="row">
        {quiet(`hide-session-${row.key}-before`, [{ text: '│', color: CHOSEN.session }, { text: ' ', backgroundColor: '#2f2a22' }])}
        {row.parts.map((part, index) => {
          let key = row.key === 'scope' ? 'hide-scope' : `hide-session-${row.key}-${index}`
          if (part.action) {
            const base = `session-${part.action}`
            key = actionKeys.has(base) ? `${base}-${row.key}-${index}` : base
            actionKeys.add(base)
          }
          if (!part.action) return quiet(key, [{ text: part.text, dimColor: row.dim, color: CHOSEN.text, backgroundColor: '#2f2a22' }])
          return <Button key={key} label={part.text} plain onPress={part.action ? () => activate(part.action!, part.target!) : hide}>
            <Text bold={part.accent} dimColor={row.dim && !part.accent} color={part.accent ? CHOSEN.session : CHOSEN.text} backgroundColor="#2f2a22">{part.text}</Text>
          </Button>
        })}
        {quiet(`hide-session-${row.key}-after`, [{ text: ' '.repeat(Math.max(0, inner - row.parts.reduce((n, part) => n + cells(part.text), 0)) + 1), backgroundColor: '#2f2a22' }, { text: '│', color: CHOSEN.session }])}
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
          return [edge(before!), { text: ` ${line.badge} `, backgroundColor: line.unavailable || line.dim ? '#3a3a3a' : color, color: line.unavailable || line.dim ? CHOSEN.grey : CHOSEN.ink, dimColor, bold: true }, edge(after!)]
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
