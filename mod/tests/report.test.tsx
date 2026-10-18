import { paneTree } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import { cells } from '../hooks/session-facts'
import { resolveConfig } from '../hooks/templates'
import { reportArguments } from '../hooks/report'
import type { On, RenderSurface } from 'claude-code'

const TOOL = 'mcp__whatsup__report'
function host(on: On) {
  mock.clock(on)
  let session = 'report-session'
  const opened: string[][] = []
  const tools: Record<string, unknown>[] = []
  const store = new Map<string, unknown>()
  on('tool.register', (_$, e) => { tools.push(e); return { value: { tool: `mcp__whatsup__${e.name}` } } })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('session.cwd', () => ({ value: '/tmp' }))
  on('session.id', () => ({ value: session }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    opened.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { opened, tools, store, session: (id: string) => { session = id } }
}
const report = ($: Engine, input: unknown) => $.tool.call({ ...(input as Record<string, unknown>), tool: TOOL })
const section = {
  label: 'Work', name: 'Public release', verb: 'closed', item_kind: 'tickets', description: 'Build the report tool',
  items: [
    { title: 'Build the whatsup report tool and section boxes', number: 10, identity: 'example/project#10', link: 'https://github.com/example/project/issues/10', state: 'active' },
    { title: 'Review the report', state: 'queued' },
    { title: 'Read the brief', state: 'done' },
  ],
}
async function start($: Engine) { await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true }) }
async function mount($: Engine, surface: RenderSurface = 'terminal', columns = 80) {
  return $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status',
    props: { title: 'whatsup', bodyColumns: columns, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    viewport: { columns: columns + 40, rows: 46, isFullscreen: true } })
}
type Node = { props?: Record<string, unknown>; children?: unknown[]; hover?: unknown }
function text(node: unknown): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  return ((node as Node).children ?? []).map(text).join('')
}
async function drawn(ui: Mounted<RenderSurface, 'Pane'>) { return text(await paneTree(ui)) }
function nodes(node: unknown): Node[] {
  if (!node || typeof node !== 'object') return []
  return [node as Node, ...((node as Node).children ?? []).flatMap(nodes)]
}

describe('context report', () => {
  test('reads the arguments the engine spreads beside its own keys', async () => {
    const event = { tool: TOOL, tool_use_id: 'toolu_1', agentId: 'agent-1', requestMeta: {}, consent: 'yes', scope: 'Live', sections: [] }
    expect(reportArguments(event)).toEqual({ scope: 'Live', sections: [] })
  })
  test('answers the model with plain text', async ($, on) => {
    host(on); await start($)
    expect(await report($, { scope: 'Live' })).toEqual({ result: 'Context report replaced.' })
  })
  test('registers exactly one report tool with its public schema', async ($, on) => {
    const { tools } = host(on); await start($)
    expect(tools).toHaveLength(1)
    expect(tools[0]!.name).toBe('report')
    expect(JSON.stringify(tools[0])).toContain('item_kind')
    expect(JSON.stringify(tools[0])).toContain('workers')
  })
  test('scope only, replacement and session isolation persist in plugin store', async ($, on) => {
    const h = host(on); await start($)
    let ui = await mount($)
    expect(await drawn(ui)).toContain('mcp__whatsup__report')
    await report($, { scope: 'Public release', sections: [section], workers: [{ name: 'generator', role: 'main', status: 'generating', state: 'running' }] })
    expect(await drawn(ui)).toContain('Public release')
    await report($, { scope: 'Read the brief' })
    expect(await drawn(ui)).toContain('Read the brief')
    expect(await drawn(ui)).not.toContain('closed')
    const keys = [...h.store.keys()]
    expect(keys.some(k => k.includes('report-session'))).toBe(true)
    const saved = h.store.get(keys.find(k => k.includes('report-session'))!)
    expect(JSON.stringify(saved)).not.toContain('generator')
    await ui.unmount()
    h.session('fresh-session')
    ui = await mount($)
    expect(await drawn(ui)).toContain('mcp__whatsup__report')
    await report($, { scope: 'Fresh scope' })
    await ui.unmount()
    h.session('report-session')
    ui = await mount($)
    expect(await drawn(ui)).toContain('Read the brief')
    expect(await drawn(ui)).not.toContain('Fresh scope')
  })
  test('refuses malformed fields without replacing the previous report', async ($, on) => {
    host(on); await start($)
    await report($, { scope: 'Keep this' })
    const ui = await mount($)
    for (const [input, field] of [
      [{ scope: 10 }, 'scope'],
      [{ scope: 'bad', sections: [{ ...section, items: [{ title: 'bad', state: 'closed' }] }] }, 'sections[0].items[0].state'],
      [{ scope: 'bad', workers: [{ name: 'worker' }] }, 'workers[0].role'],
      [{ scope: 'bad', extra: true }, 'extra'],
      [JSON.parse('{"scope":"bad","constructor":true}'), 'constructor'],
    ] as const) {
      const result = await report($, input)
      expect(JSON.stringify(result)).toContain(field)
      expect(await drawn(ui)).toContain('Keep this')
    }
  })
  test('empty help fits 40 columns, section names can open links, and replacement clears UI state', async ($, on) => {
    const h = host(on); await start($)
    const ui = await mount($, 'terminal', 40)
    expect(await drawn(ui)).toContain('{"scope":')
    await report($, { scope: 'Public release', sections: [{ ...section, link: 'https://github.com/example/project/issues/10' }] })
    await ui.press({ key: 'show-section-0' })
    expect(await drawn(ui)).toContain('open ↗')
    await ui.press({ key: 'open-section-0' })
    expect(h.opened).toHaveLength(1)
    await report($, { scope: 'Replacement', sections: [section] })
    expect(nodes(await paneTree(ui)).filter(n => n.props?.position === 'absolute')).toHaveLength(0)
    expect(await drawn(ui)).not.toContain('tickets')
    await ui.press({ key: 'show-section-0' })
    await $.command.run({ command: 'session-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
    expect(nodes(await paneTree(ui)).filter(n => n.props?.position === 'absolute')).toHaveLength(0)
  })
  test('section boxes, expansion, three states and click-only floating cards at 40 and 80 columns', async ($, on) => {
    const h = host(on); await start($)
    await report($, { scope: 'Public release', sections: [section, { label: 'Notes', verb: 'read', item_kind: 'notes' }] })
    for (const surface of ['terminal', 'desktop'] as const) for (const columns of [40, 80]) {
      const ui = await mount($, surface, columns)
      expect(await drawn(ui)).toContain(columns < 56 ? '1/3' : '1/3 closed')
      expect(nodes(await paneTree(ui)).some(n => n.props?.backgroundColor && text(n).includes(columns < 56 ? '1/3' : '1/3 closed'))).toBe(true)
      expect(await drawn(ui)).toContain('33%')
      expect(await drawn(ui)).toContain('·')
      expect(await drawn(ui)).toContain('░')
      expect(await drawn(ui)).not.toContain('tickets')
      await ui.press({ key: 'expand-section-0' })
      expect(await drawn(ui)).toContain('tickets')
      for (const glyph of ['✓', '◐', '○']) expect(await drawn(ui)).toContain(glyph)
      const tree = await paneTree(ui)
      const top = (tree.children ?? []).findIndex((node: Node) => node.props?.key === 'hide-session-top')
      expect((tree.children[top + 1] as Node).props?.key).toBe('hide-session-top-space')
      expect(text(tree.children[top + 1])).toBe('│' + ' '.repeat(columns - 2) + '│')
      expect((tree.children[top + 2] as Node).props?.key).toBe('session-row-scope')
      expect(nodes(tree).some(n => n.props?.underline === true)).toBe(true)
      expect(nodes(tree).every(n => n.hover === undefined)).toBe(true)
      await ui.press({ key: 'show-section-0-item-0' })
      expect(await drawn(ui)).toContain('open ↗')
      await ui.press({ key: 'open-section-0-item-0' })
      expect(h.opened.at(-1)?.at(-1)).toBe(section.items[0]!.link)
      await ui.press({ key: 'show-section-0-item-1' })
      expect(await drawn(ui)).not.toContain('open ↗')
      expect(nodes(await paneTree(ui)).filter(n => n.props?.position === 'absolute')).toHaveLength(1)
      await ui.press({ key: 'show-section-0-item-1' })
      expect(nodes(await paneTree(ui)).filter(n => n.props?.position === 'absolute')).toHaveLength(0)
      await ui.press({ key: 'show-section-0' })
      expect(nodes(await paneTree(ui)).filter(n => n.props?.position === 'absolute')).toHaveLength(1)
      await ui.pointer({ in: 'hide-scope', type: 'down', x: 0, y: 0, button: 'left' })
      expect(nodes(await paneTree(ui)).filter(n => n.props?.position === 'absolute')).toHaveLength(0)
      await ui.press({ key: 'expand-section-0' })
      expect(await drawn(ui)).not.toContain('tickets')
      await ui.unmount()
    }
  })
  test('overflow controls remain in the visible window at 58 columns', async ($, on) => {
    host(on); await start($)
    await report($, { scope: 'Build Session Status initial slices', sections: ['Project', 'Milestone', 'Epic', 'Queue'].map(label => ({ ...section, label })),
      workers: [
        { name: 'session', role: 'main', status: 'waiting', state: 'waiting' },
        { name: 'adapter', role: 'gen-runtime', status: 'generating', state: 'running' },
        { name: 'reviewer', role: 'eval-web', status: 'done', state: 'done' },
      ] })
    for (const surface of ['terminal', 'desktop'] as const) {
      const props = { title: 'whatsup', bodyColumns: 58, isFocused: true, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 14 }, view: {} }
      const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status', props,
        viewport: { columns: 60, rows: 51, isFullscreen: true } })
      let tree = await paneTree(ui)
      let footer = nodes(tree).find(n => n.props?.key === 'overflow-controls')!
      expect(footer, 'overflow has a visible continuation cue').toBeDefined()
      expect(footer.props?.top).toBe(13)
      expect(text(footer)).toContain('More ↓')
      expect(await ui.find({ key: 'pane-next' })).toBeDefined()
      // The full content remains in the native scroll tree, including the last worker.
      expect(text(tree)).toContain('Queue')
      expect(text(tree)).toContain('eval-web')
      await ui.redraw({ ...props, scroll: { offset: 13, bodyRows: 14 } })
      tree = await paneTree(ui)
      footer = nodes(tree).find(n => n.props?.key === 'overflow-controls')!
      expect(footer.props?.top).toBe(26)
      expect(text(footer)).toContain('↑ Back')
      expect(text(footer)).toContain('More ↓')
      const lastOffset = (tree.children ?? []).filter((n: Node) => n.props?.position !== 'absolute').length - 14
      await ui.redraw({ ...props, scroll: { offset: lastOffset, bodyRows: 14 } })
      expect(await ui.find({ key: 'pane-next' })).toBeUndefined()
      expect(await ui.find({ key: 'pane-previous' })).toBeDefined()
      await ui.redraw({ ...props, scroll: { offset: 0, bodyRows: 200 } })
      expect(await ui.find({ key: 'overflow-controls' })).toBeUndefined()
      await ui.unmount()
    }
  })

  test('floating cards fit above the overflow footer at scrolled offsets', async ($, on) => {
    host(on); await start($)
    // Long-description boundary variant of the existing section fixture.
    await report($, { scope: 'Public release', sections: [{ ...section, description: section.description.repeat(100) }] })
    for (const surface of ['terminal', 'desktop'] as const) {
      const props = { title: 'whatsup', bodyColumns: 58, isFocused: true, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 14 }, view: {} }
      const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status', props,
        viewport: { columns: 60, rows: 51, isFullscreen: true } })
      const initial = await paneTree(ui)
      const itemRow = initial.children.findIndex((n: Node) => n.props?.key === 'line-section-0')
      expect(itemRow).toBeGreaterThan(0)
      for (const rows of [2, 3, 14]) {
        await ui.redraw({ ...props, scroll: { offset: itemRow, bodyRows: rows } })
        await ui.press({ key: 'show-section-0' })
        const tree = await paneTree(ui)
        const footer = nodes(tree).find(n => n.props?.key === 'overflow-controls')!
        const card = nodes(tree).find(n => n.props?.key === 'card-section-0')!
        expect(card).toBeDefined()
        expect(Number(card.props?.top)).toBeGreaterThanOrEqual(itemRow)
        expect(Number(card.props?.top) + card.children!.length, 'all card rows clear the pinned footer').toBeLessThanOrEqual(Number(footer.props?.top))
        await ui.press({ key: 'show-section-0' })
      }
      await ui.unmount()
    }
  })

  test('a one-row viewport keeps content exposed to native scrolling', async ($, on) => {
    host(on); await start($)
    await report($, { scope: 'Public release', sections: [section] })
    for (const surface of ['terminal', 'desktop'] as const) {
      const props = { title: 'whatsup', bodyColumns: 58, isFocused: true, placement: 'inline' as const, scroll: { offset: 0, bodyRows: 1 }, view: {} }
      const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status', props,
        viewport: { columns: 60, rows: 8, isFullscreen: true } })
      const tree = await paneTree(ui)
      const contentRows = tree.children.filter((n: Node) => n.props?.position !== 'absolute').length
      for (const offset of [0, 1, contentRows - 1]) {
        await ui.redraw({ ...props, scroll: { offset, bodyRows: 1 } })
        expect(await ui.find({ key: 'overflow-controls' })).toBeUndefined()
        expect(await ui.find({ key: 'hide-overflow-end' })).toBeUndefined()
        expect(await drawn(ui)).toContain('Public release')
      }
      await ui.unmount()
    }
  })

  test('Unicode section rows and cards fit beneath both session densities', async ($, on) => {
    const h = host(on); await start($)
    // Boundary variant of the report fixture, retaining its item identity and actions.
    const title = '文'.repeat(100) + ' 🌿'
    await report($, { scope: 'Public release', sections: [{ ...section, label: '文'.repeat(20), description: title, items: [{ ...section.items[0], title }] }] })
    for (const density of ['compact', 'full']) for (const columns of [40, 80]) {
      h.store.set('template-config:report-session', resolveConfig(undefined, { session: { density } }))
      const ui = await mount($, 'terminal', columns)
      await ui.press({ key: 'expand-section-0' })
      const tree = await paneTree(ui)
      for (const node of nodes(tree).filter(n => String(n.props?.key ?? '').startsWith('line-section-'))) expect(cells(text(node))).toBe(columns)
      const description = nodes(tree).find(n => n.props?.key === 'hide-section-0-description')!
      expect(cells(text(description))).toBe(columns)
      await ui.press({ key: 'show-section-0-item-0' })
      const card = nodes(await paneTree(ui)).find(n => n.props?.position === 'absolute')!
      for (const row of card.children ?? []) expect(cells(text(row))).toBe(Number(card.props?.width))
      await ui.press({ key: 'open-section-0-item-0' })
      expect(h.opened.at(-1)?.at(-1)).toBe(section.items[0]!.link)
      await ui.press({ key: 'expand-section-0' })
      await ui.unmount()
    }
  })

})
