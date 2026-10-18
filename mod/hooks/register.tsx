import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import { FOOTER, MARKER_WIDTH, NO_PAGE, OPEN_LABEL, paneLines, placeCard, wrap } from './layout'
import type { Item, Line, Part } from './layout'
import { DEFAULT_SNAPSHOT, SNAPSHOTS } from './snapshots'
import { registerEnrichment } from './enrichment'
import { readSessionEnvironment, registerSessionFacts } from './session-facts'
import { paneWorkers, registerWorkers } from './workers'
import { registerReportPane } from './report-pane'
import { REPORT_SCHEMA, REPORT_DESCRIPTION, REPORT_TOOL, reportArguments, reportError, reportKey } from './report'
import type { ContextReport } from './report'
import { configKey, initialExpanded, resolveConfig, sessionInstruction } from './templates'
import type { Template } from './templates'

const PANE = 'session-status'
const TITLE = 'Session Status'
// The key of the item whose card is shown, or null: one card at a time.
const openCard = atom({ plugin: 'whatsup', key: 'openCard' } as const, null)

export const register: Register = (on, options) => {
  const recorded = typeof options.snapshot === 'string' && options.snapshot in SNAPSHOTS
  registerWorkers(on, recorded)
  registerSessionFacts(on, recorded)
  registerReportPane(on, recorded)
  registerEnrichment(on, recorded, typeof options.githubIssueKinds === 'string' ? options.githubIssueKinds : undefined)
  const chosen = typeof options.snapshot === 'string' && options.snapshot in SNAPSHOTS ? options.snapshot : DEFAULT_SNAPSHOT
  const entry = SNAPSHOTS[chosen]!

  on('session.start', async ($, e, next) => {
    if (!recorded) await readSessionEnvironment($, await $.session.id(), e.cwd)
    await $.tool.register({ name: 'report', description: REPORT_DESCRIPTION, inputSchema: REPORT_SCHEMA })
    const home = await $.env.get('HOME')
    const userPath = home ? `${home}/.config/whatsup/config.json` : null
    let directory = e.cwd.replace(/\/$/, '') || '/'
    while (directory !== '/' && !await $.fs.exists(`${directory}/.git`)) directory = directory.slice(0, directory.lastIndexOf('/')) || '/'
    if (directory === '/' && !await $.fs.exists('/.git')) directory = e.cwd.replace(/\/$/, '')
    const repoPath = `${directory}/.whatsup.json`
    const user = userPath && await $.fs.exists(userPath) ? JSON.parse(await $.fs.read(userPath)) : undefined
    const repository = await $.fs.exists(repoPath) ? JSON.parse(await $.fs.read(repoPath)) : undefined
    const config = resolveConfig(user, repository)
    sessionInstruction(config) // Validate the instruction budget at startup.
    await $.store.set(configKey(await $.session.id()), config)
    // Core may cache prompt.context before this async startup handler finishes.
    $.ui.invalidate('prompt.context')
    await $.command.register({ name: 'whatsup', description: 'Show this session’s scope, progress and workers' })
    // Registers the command only; the pane opens when the person asks for it.
    await $.command.register({ name: 'session-status', description: 'Show this session’s project, progress and in-progress tickets' })
    return next(e)
  })

  on('prompt.context', async ($, e, next) => {
    const result = await next(e)
    const config = await $.store.get(configKey(await $.session.id())) as Template | undefined
    const instruction = config ? sessionInstruction(config) : ''
    return instruction ? { ...result, blocks: [...result.blocks, { name: 'whatsup', text: instruction }] } : result
  })

  on('tool.call', { tool: REPORT_TOOL }, async ($, e) => {
    const input = reportArguments(e)
    const error = reportError(input)
    if (error) return { deny: error }
    const session = await $.session.id()
    await $.store.set(reportKey(session), input as ContextReport)
    if (!recorded) await paneWorkers($, await $.clock.now())
    const config = await $.store.get(configKey(session)) as Template | undefined
    await update($, { plugin: 'whatsup', key: 'reportViews' } as const, all => ({ ...all, [session]: { shown: null, expanded: initialExpanded(config ?? resolveConfig(), input as ContextReport) } }))
    $.ui.invalidate('ui.render')
    // A registered tool answers with plain text; the engine refuses an MCP-style content object.
    return { result: 'Context report replaced.' }
  })

  for (const command of ['whatsup', 'session-status']) on('command.run', { command }, async $ => {
    // Each opening starts with no card shown.
    await update($, openCard, () => null)
    const session = await $.session.id()
    const config = recorded ? undefined : await $.store.get(configKey(session)) as Template | undefined
    const report = recorded ? null : await $.store.get(reportKey(session)) as ContextReport | null
    await update($, { plugin: 'whatsup', key: 'reportViews' } as const, all => ({ ...all, [session]: { shown: null, expanded: initialExpanded(config ?? resolveConfig(), report) } }))
    await $.ui.open({ id: PANE, title: TITLE })
    return { text: recorded ? `Session Status opened with recorded snapshot "${chosen}".` : 'whatsup opened for this session.' }
  })

  if (recorded) on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const columns = Math.max(MARKER_WIDTH + 1, e.props.bodyColumns)
    const windowRows = Math.max(1, e.props.scroll.bodyRows)
    const offset = e.props.scroll.offset
    const shown = await read($, openCard)
    const lines = paneLines(entry.snapshot, chosen, columns - MARKER_WIDTH)

    const openPage = async (page: string) => {
      try {
        const run = await $.process.run(['open', page])
        if (run.exitCode !== 0) $.ui.toast(`Couldn't open ${page}`)
      } catch {
        $.ui.toast(`Couldn't open ${page}`)
      }
    }

    // A press on the shown item, or anywhere else in the pane, hides the card; another item swaps it.
    const show = (key: string) => update($, openCard, current => (current === key ? null : key))
    const hide = () => update($, openCard, () => null)

    const styled = (part: Part, index: number) => (
      <Text key={String(index)} dimColor={part.dim} bold={part.bold}>{part.text}</Text>
    )

    // Every cell of the pane is a press target: a show Button on an item's
    // marker and text, a hide Button over everything else, padded with spaces
    // to the pane's right edge.
    const blank = (key: string, width: number) => (
      <Button key={key} label={' '.repeat(width)} plain onPress={hide}>{' '.repeat(width)}</Button>
    )

    const card = (item: Item, row: number) => {
      const box = placeCard(item.page === null ? NO_PAGE : OPEN_LABEL, item.details, row, offset, windowRows, columns)
      const inner = box.width - (box.bordered ? 4 : 0)
      // The border is drawn as text, not borderStyle, so its cells hide the card too.
      // Spaces, not padding: padding cells are not painted, and the rows beneath would show through.
      const left = box.bordered ? '│ ' : ''
      const right = box.bordered ? ' │' : ''
      // The head as placeCard clipped it to the card, then the blank space beside it and the right border.
      const head = box.lines[0]!
      const beside = ' '.repeat(inner - head.length) + right
      const edge = (key: string, corners: string) => {
        const text = corners[0] + '─'.repeat(box.width - 2) + corners[1]
        return <Button key={`hide-card-${item.key}-${key}`} label={text} plain onPress={hide}>{text}</Button>
      }
      return (
        <Box key={`card-${item.key}`} position="absolute" top={row + box.top} left={0} width={box.width} flexDirection="column">
          {box.bordered && edge('top', '╭╮')}
          {box.lines.map((text, index) =>
            index === 0 && item.page !== null
              ? (
                  <Box key="head" flexDirection="row">
                    {box.bordered && <Button key={`hide-card-${item.key}-before`} label={left} plain onPress={hide}>{left}</Button>}
                    <Button key={`open-${item.key}`} label={head} plain onPress={() => openPage(item.page!)}>{head}</Button>
                    {beside.length > 0 && <Button key={`hide-card-${item.key}-beside`} label={beside} plain onPress={hide}>{beside}</Button>}
                  </Box>
                )
              : <Button key={`hide-card-${item.key}-${index}`} label={left + text.padEnd(inner) + right} plain onPress={hide}>{left + text.padEnd(inner) + right}</Button>,
          )}
          {box.bordered && edge('bottom', '╰╯')}
        </Box>
      )
    }

    const lineOf = (line: Line) => {
      const text = line.parts.map(part => part.text).join('')
      const rest = ' '.repeat(Math.max(0, columns - MARKER_WIDTH - text.length))
      if (line.item) {
        const { item } = line
        return (
          <Box key={`line-${item.key}`} flexDirection="row">
            <Button key={`show-${item.key}`} label={`▸ ${text}`} plain onPress={() => show(item.key)}>
              {'▸ '}{line.parts.map(styled)}
            </Button>
            {rest.length > 0 && <Button key={`hide-${item.key}-rest`} label={rest} plain onPress={hide}>{rest}</Button>}
          </Box>
        )
      }
      if (text.trim() === '') return blank(`hide-${line.key}`, columns)
      return (
        <Button key={`hide-${line.key}`} label={' '.repeat(MARKER_WIDTH) + text + rest} plain onPress={hide}>
          {' '.repeat(MARKER_WIDTH)}{line.parts.map(styled)}{rest}
        </Button>
      )
    }

    const footer = wrap(FOOTER, columns)
    // The rows between the footer and the pane's bottom edge, when the content is shorter than the window.
    const below = Math.max(0, windowRows - lines.length - 1 - footer.length)
    const shownRow = lines.findIndex(line => line.item?.key === shown)
    return (
      <Box flexDirection="column" width={columns} minHeight={windowRows}>
        {lines.map(lineOf)}
        {blank('hide-gap-footer', columns)}
        {footer.map((text, index) => {
          const padded = text.padEnd(columns)
          return <Button key={`hide-footer-${index}`} label={padded} plain dimColor onPress={hide}>{padded}</Button>
        })}
        {Array.from({ length: below }, (_, index) => blank(`hide-below-${index}`, columns))}
        {/* Drawn last, so no line paints over it. */}
        {shownRow >= 0 && card(lines[shownRow]!.item!, shownRow)}
      </Box>
    )
  })
}
