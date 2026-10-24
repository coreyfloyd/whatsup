import { decision } from './fixtures/decision'
import { paneTree, desktopPane } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import { CHOSEN, SECTION_STYLES } from '../hooks/chosen-style'
import type { On, RenderSurface } from 'claude-code'

const TOOL = 'mcp__whatsup__report'
function host(on: On) {
  const clock = mock.clock(on)
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
  return { clock, opened, tools, store, session: (id: string) => { session = id } }
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
  const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status',
    props: { title: 'whatsup', bodyColumns: columns, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    viewport: { columns: columns + 40, rows: 46, isFullscreen: true } })
  return surface === 'desktop' ? desktopPane(ui) : ui
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

describe('Desktop native pane', () => {
  for (const columns of [40, 58, 80]) test(`native boxes and actions at ${columns} columns`, async ($, on) => {
    const h = host(on); const inputs: any[] = []
    on('prompt.submit', (_$, e) => { inputs.push(e); return { text: e.text, origin: e.origin } })
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    await start($)
    await report($, { scope: 'Design pending decisions in the pane', decisions: [decision, { ...decision, identity: 'second' }], sections: [section], workers: [{ name: 'session', role: 'main', status: 'waiting', state: 'waiting' }] })
    const ui = await mount($, 'desktop', columns)
    const check = async () => {
      const tree = await paneTree(ui)
      expect(text(tree)).not.toMatch(/[─│┌┐└┘╭╮╰╯]/)
      for (const n of nodes(tree)) for (const child of n.children ?? []) if (typeof child === 'string') expect(child).not.toMatch(/ +$/)
      const boxes = nodes(tree).filter(n => n.props?.borderStyle)
      expect(boxes.length).toBeGreaterThanOrEqual(5)
      for (const box of boxes) {
        expect((box as any).type).toBe('Box')
        expect(typeof box.props?.borderColor).toBe('string')
        expect(typeof box.props?.backgroundColor).toBe('string')
      }
      expect(boxes.map(n => n.props?.borderColor)).toContain(CHOSEN.session)
      expect(boxes.map(n => n.props?.borderColor)).toContain(SECTION_STYLES[0]!.accent)
      expect(boxes.map(n => n.props?.borderColor)).toContain('#ececec')
      expect(text(tree)).toContain('claude-sonnet-5-5')
    }
    await check()
    expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
    await ui.press({ key: 'expand-decision-0' })
    await ui.press({ key: 'select-decision-0-0' }); await check()
    expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
    await ui.press({ key: 'clear-decision-0' })
    expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
    await ui.press({ key: 'select-decision-0-1' })
    await ui.press({ key: 'discuss-decision-0' })
    expect(inputs).toHaveLength(1)
    expect(await drawn(ui)).toContain('Discussion requested')
    await ui.press({ key: 'expand-decision-1' })
    expect(await ui.find({ key: 'select-decision-0-0' })).toBeUndefined()
    await ui.press({ key: 'expand-decision-0' })
    await ui.press({ key: 'send-decision-0' })
    expect(inputs).toHaveLength(2)
    expect(JSON.parse(inputs[1].text).answer).toEqual(decision.options[1])
    expect(await drawn(ui)).toContain('Sent — awaiting agent')
    await ui.press({ key: 'session-copy-id' })
    expect(h.opened.at(-1)?.[0]).toBe('pbcopy')
    await ui.press({ key: 'session-open-folder' })
    expect(h.opened.at(-1)).toEqual(['open', '--', '/tmp'])
    await ui.press({ key: 'expand-section-0' })
    await ui.press({ key: 'show-section-0-item-0' }); await check()
    await ui.press({ key: 'open-section-0-item-0' })
    expect(h.opened.at(-1)?.at(-1)).toBe(section.items[0]!.link)
    await ui.press({ key: 'show-section-0-item-0' })
    await ui.press({ key: 'close-section-0-item-0' })
    expect(await ui.find({ key: 'card-section-0-item-0' })).toBeUndefined()
    const props = { title: 'whatsup', bodyColumns: columns, isFocused: false, placement: 'dock' as const, scroll: { offset: 0, bodyRows: 4 }, view: {} }
    await ui.redraw(props)
    expect(await ui.find({ key: 'pane-next' })).toBeUndefined()
    expect(await ui.find({ key: 'overflow-controls' })).toBeUndefined()
    await ui.redraw({ ...props, scroll: { offset: 3, bodyRows: 4 } })
    expect(await ui.find({ key: 'pane-previous' })).toBeUndefined()
    await ui.unmount()
  })
  for (const columns of [40, 58, 80]) {
    test(`expanded parts have vertical separation at ${columns} columns`, async ($, on) => {
      host(on); await start($)
      await report($, { scope: 'Public release', decisions: [decision, { ...decision, identity: 'second' }], sections: [section],
        workers: [{ name: 'session', role: 'main', status: 'waiting', state: 'waiting' }] })
      const ui = await mount($, 'desktop', columns)
      await ui.press({ key: 'expand-section-0' })
      await ui.press({ key: 'expand-decision-0' })
      await ui.press({ key: 'select-decision-0-0' })
      for (const part of ['space', 'why-space', 'context-space', 'recommendation-space', 'option-0-space', 'option-1-space', 'end-space']) {
        const spacer = await ui.find({ key: `hide-decision-0-${part}-0` }) as Node
        expect(spacer.props?.height).toBe(1)
        expect(text(spacer)).toBe('')
      }
      expect((await ui.find({ key: 'hide-section-0-top-space' }) as Node).props?.height).toBe(1)
      for (const key of ['hide-section-0-description', 'hide-section-0-kind', 'line-section-0-item-0']) {
        expect((await ui.find({ key }) as Node).props?.marginTop).toBe(1)
      }
      // Consecutive items remain a single list, without an extra gap per item.
      expect((await ui.find({ key: 'line-section-0-item-1' }) as Node).props?.marginTop).toBeUndefined()
      expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
      await ui.unmount()
    })

    test(`native scrolling never renders paging at ${columns} columns`, async ($, on) => {
      host(on); await start($)
      await report($, { scope: 'Public release', decisions: [decision], sections: [{ ...section, description: section.description.repeat(100) }] })
      const ui = await mount($, 'desktop', columns)
      await ui.press({ key: 'expand-decision-0' })
      await ui.press({ key: 'expand-section-0' })
      expect(await ui.find({ key: 'overflow-controls' })).toBeUndefined()
      for (const height of [1, 4, 14, 40, 400]) for (const offset of [0, 13, 100]) {
        await ui.redraw({ title: 'whatsup', bodyColumns: columns, isFocused: false, placement: 'dock', scroll: { offset, bodyRows: height }, view: {} })
        await ui.resize({ in: 'desktop-pane', columns, rows: height })
        await ui.advance(32)
        for (const key of ['pane-next', 'pane-previous', 'overflow-controls']) expect(await ui.find({ key })).toBeUndefined()
        expect(await drawn(ui)).toContain(section.description.repeat(100))
      }
      await ui.unmount()
    })
  }

  test('outside pane clicks dismiss an item card', async ($, on) => {
    host(on); await start($)
    await report($, { scope: 'Public release', sections: [section] })
    const ui = await mount($, 'desktop', 58)
    await ui.resize({ in: 'desktop-pane', columns: 58, rows: 40 })
    // A Button gesture must survive the containing client's pointer listener.
    await ui.pointer({ in: 'desktop-pane', type: 'down', x: 2, y: 8, button: 'left' })
    await ui.press({ key: 'show-section-0' })
    await ui.pointer({ in: 'desktop-pane', type: 'up', x: 2, y: 8, button: 'left' })
    await ui.advance(32)
    expect(await ui.find({ key: 'card-section-0' })).toBeDefined()
    for (const [x, y] of [[1, 1], [1, 8], [57, 39]]) {
      await ui.pointer({ in: 'desktop-pane', type: 'down', x, y, button: 'left' })
      await ui.pointer({ in: 'desktop-pane', type: 'up', x, y, button: 'left' })
      await ui.advance(32)
      expect(await ui.find({ key: 'card-section-0' })).toBeUndefined()
      await ui.press({ key: 'show-section-0' })
    }
    await ui.unmount()
  })

  test('native actions remain usable after remounting an unchanged pane', async ($, on) => {
    const h = host(on); await start($)
    await report($, { scope: 'Public release' })
    const first = await mount($, 'desktop', 58)
    await first.press({ key: 'session-copy-id' })
    expect(h.opened.filter(a => a[0] === 'pbcopy')).toHaveLength(1)
    await first.unmount()
    const restored = await mount($, 'desktop', 58)
    await restored.press({ key: 'session-copy-id' })
    expect(h.opened.filter(a => a[0] === 'pbcopy')).toHaveLength(2)
    await restored.unmount()
  })

  test('replayed or stale native action packets cannot toggle or send twice', async ($, on) => {
    host(on); const inputs: any[] = []
    on('prompt.submit', (_$, e) => { inputs.push(e); return { text: e.text, origin: e.origin } })
    await start($)
    await report($, { scope: 'Public release', decisions: [decision], sections: [section] })
    const ui = await mount($, 'desktop', 58)
    const revision = (await ui.drawn() as any).props.props.revision
    const packet = { action: 'show-section-0', revision, sequence: 100 }
    await ui.post(packet)
    await ui.advance(32)
    expect(await ui.find({ key: 'card-section-0' })).toBeDefined()
    await ui.post(packet)
    await ui.advance(32)
    expect(await ui.find({ key: 'card-section-0' })).toBeDefined()
    await ui.press({ key: 'expand-decision-0' })
    await ui.press({ key: 'select-decision-0-0' })
    const selected = (await ui.drawn() as any).props.props.revision
    await report($, { scope: 'Public release', decisions: [{ ...decision, context: decision.context + ' Revised.' }] })
    await ui.redraw()
    await ui.post({ action: 'send-decision-0', revision: selected, sequence: 101 })
    await ui.advance(32)
    expect(inputs).toHaveLength(0)
    expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
    await ui.unmount()
  })

  for (const columns of [40, 58, 80]) for (const placement of ['dock', 'inline'] as const) {
    test(`empty sections, original indexes and three item states at ${columns}, ${placement}`, async ($, on) => {
      const h = host(on); await start($)
      const empty = { label: section.label, verb: section.verb, item_kind: section.item_kind }
      await report($, { scope: 'Public release', sections: [empty, { ...empty, name: section.name }, { ...empty, name: '', description: '', items: [] }, section, empty, { ...empty, description: section.description }],
        workers: [{ name: 'session', role: 'main', status: 'waiting', state: 'waiting' }, { name: 'adapter', role: 'gen-runtime', status: 'generating', state: 'running' }, { name: 'reviewer', role: 'eval-web', status: 'done', state: 'done' }] })
      const ui = await mount($, 'desktop', columns)
      await ui.redraw({ title: 'whatsup', bodyColumns: columns, isFocused: false, placement, scroll: { offset: 0, bodyRows: 40 }, view: {} })
      const tree = await paneTree(ui)
      expect(nodes(tree).map(n => n.props?.key).filter(key => /^line-section-\d+$/.test(String(key)))).toEqual(['line-section-1', 'line-section-3', 'line-section-5'])
      for (const index of [1, 5]) {
        expect(text(await ui.find({ key: `line-section-${index}` }))).not.toContain('0/0')
        expect(await ui.find({ key: `hide-section-${index}-bar` })).toBeUndefined()
        await ui.press({ key: `expand-section-${index}` })
        expect(await ui.find({ key: `hide-section-${index}-kind` })).toBeDefined()
      }
      expect(await drawn(ui)).toContain(section.description)
      expect(await drawn(ui)).toContain(columns < 56 ? '1/3' : '1/3 tickets closed')
      const bar = text(await ui.find({ key: 'hide-section-3-bar' }))
      for (const segment of ['33%', '█', '░', '·']) expect(bar).toContain(segment)
      await ui.press({ key: 'expand-section-3' })
      for (const glyph of ['✓', '◐', '○']) expect(await drawn(ui)).toContain(glyph)
      expect(nodes(await paneTree(ui)).some(n => n.props?.underline === true)).toBe(true)
      expect(nodes(await paneTree(ui)).every(n => n.hover === undefined)).toBe(true)
      await ui.press({ key: 'show-section-3-item-0' })
      expect(await ui.find({ key: 'card-section-3-item-0' })).toBeDefined()
      expect(h.opened.filter(a => a[0] === 'open')).toHaveLength(0)
      await ui.press({ key: 'show-section-3-item-1' })
      expect(await ui.find({ key: 'card-section-3-item-0' })).toBeUndefined()
      expect(await ui.find({ key: 'card-section-3-item-1' })).toBeDefined()
      expect(await ui.find({ key: 'open-section-3-item-1' })).toBeUndefined()
      await ui.press({ key: 'show-section-3-item-1' })
      expect(await ui.find({ key: 'card-section-3-item-1' })).toBeUndefined()
      const output = await drawn(ui)
      expect(output.indexOf('Session')).toBeLessThan(output.indexOf(section.name))
      expect(output.indexOf(section.name)).toBeLessThan(output.indexOf('Agents'))
      expect(output.indexOf('main · session')).toBeLessThan(output.indexOf('gen-runtime · adapter'))
      expect(output).toContain('eval-web · reviewer')
      expect(output).toContain('1 running')
      await report($, { scope: 'Public release', sections: [empty] })
      expect(await drawn(ui)).toContain('Session')
      expect(await drawn(ui)).toContain('Agents')
      expect(nodes(await paneTree(ui)).some(n => /^desktop-section-/.test(String(n.props?.key)))).toBe(false)
      await ui.unmount()
    })

    test(`long descriptions, decision order and reset at ${columns}, ${placement}`, async ($, on) => {
      const h = host(on); await start($)
      const long = section.description.repeat(100)
      const input = { scope: 'Public release', decisions: [decision, { ...decision, identity: 'second' }], sections: [{ ...section, description: long }] }
      await report($, input)
      const ui = await mount($, 'desktop', columns)
      const props = { title: 'whatsup', bodyColumns: columns, isFocused: false, placement, scroll: { offset: 0, bodyRows: 14 }, view: {} }
      await ui.redraw(props)
      expect(await drawn(ui)).toContain('ANSWER NEEDED')
      expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
      await ui.press({ key: 'expand-decision-0' })
      expect(await drawn(ui)).toContain('Recommended: Expand one at a time')
      const output = await drawn(ui)
      expect(output.indexOf('Session')).toBeLessThan(output.indexOf('Decision 1'))
      const keys = nodes(await paneTree(ui)).map(n => n.props?.key)
      expect(keys.indexOf('desktop-decision-1')).toBeLessThan(keys.indexOf('desktop-section-0'))
      await ui.press({ key: 'expand-section-0' })
      expect(await drawn(ui)).toContain(long)
      await ui.press({ key: 'show-section-0' })
      expect(text(await ui.find({ key: 'card-section-0' }))).toContain(long)
      for (const offset of [0, 13, 26]) {
        await ui.redraw({ ...props, scroll: { offset, bodyRows: 14 } })
        expect(text(await ui.find({ key: 'card-section-0' }))).toContain(long)
        expect(await ui.find({ key: 'pane-next' })).toBeUndefined()
      }
      expect(h.opened.filter(a => a[0] === 'open')).toHaveLength(0)
      await report($, input)
      expect(await ui.find({ key: 'card-section-0' })).toBeUndefined()
      expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
      await ui.press({ key: 'expand-decision-0' })
      await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
      expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
      await ui.unmount()
      const restored = await mount($, 'desktop', columns)
      expect(await drawn(restored)).not.toContain('WHY THIS MATTERS')
      await restored.unmount()
    })
  }

})

// Exercise the same report through both renderers, including redraw state changes.
for (const surface of ['terminal', 'desktop'] as const) test(`cool palette and worker states on ${surface}`, async ($, on) => {
  host(on)
  on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
  let warning = false
  on('session.usage', () => ({ value: { context: { tokens: warning ? 83000 : 40000, window: 100000 }, rateLimits: [] } }))
  await start($)
  const accents = ['#6ad4a8', '#5aa9ff', '#b6e05a', '#58c8d8', '#6ad4a8', '#5aa9ff']
  const tints = ['#1b2e27', '#1c2636', '#262e1c', '#1b2c30']
  const gradients = [['#2fa87a', '#b8f0d8'], ['#2f7fe0', '#b8d6ff'], ['#86b832', '#e2f5b8'], ['#2ea2b5', '#b8ecf3']]
  const palette = { running: ['#e39b3a', '#302518'], waiting: ['#ececec', undefined], failed: ['#ff7b86', '#33222a'], done: ['#808080', undefined] }
  const sections = accents.map(() => section)
  const roles = ['main', 'gen-runtime', 'eval-web', 'testing']
  const input = (state: keyof typeof palette, warning = false) => ({ scope: 'Public release', sections, decisions: [decision],
    workers: roles.map((role, i) => ({ name: i ? role : 'session', role, state, status: 'reviewing', model: 'claude-sonnet-5-5', tokens: [4000], context: { tokens: warning ? 83000 : 40000, window: 100000 } })) })
  await report($, input('running'))
  const ui = await mount($, surface)
  for (const state of ['running', 'waiting', 'failed', 'done', 'running'] as const) {
    warning = false
    await report($, input(state)); await ui.redraw()
    if (surface === 'desktop') await ui.advance(32)
    for (let i = 0; i < accents.length; i++) await ui.press({ key: `expand-section-${i}` })
    const tree = await paneTree(ui), all = nodes(tree)
    const drawnNode = (key: string) => all.find(n => n.props?.key === key)
    const colors = all.map(n => n.props?.color)
    expect(colors).toContain('#9fd3e8')
    expect(all.map(n => n.props?.backgroundColor)).toContain('#1f2a30')
    expect(colors).toContain('#ff7b86')
    expect(colors).toContain('#e39b3a') // Agents header
    for (let i = 0; i < accents.length; i++) {
      const header = drawnNode(`line-section-${i}`)
      expect(nodes(header).map(n => n.props?.color)).toContain(accents[i])
      const bar = drawnNode(`hide-section-${i}-bar`)
      const barColors = nodes(bar).map(n => n.props?.color)
      expect(barColors).toContain(accents[i])
      for (const stop of gradients[i % 4]!) expect(barColors).toContain(stop)
      expect(nodes(drawnNode(`line-section-${i}-item-0`)).map(n => n.props?.color)).toContain(accents[i])
      expect(all.map(n => n.props?.backgroundColor)).toContain(tints[i % 4])
    }
    for (let i = 0; i < roles.length; i++) {
      const [accent, tint] = palette[state]
      const title = drawnNode(`hide-worker-${i}`)
      expect(nodes(title).map(n => n.props?.color)).toContain(accent)
      for (const part of i ? ['graph', 'status'] : ['status']) {
        const row = nodes(drawnNode(`hide-worker-${i}-${part}`))
        expect(row.filter(n => n.props?.color === accent).length).toBeGreaterThan(0)
        expect(row.filter(n => n.props?.color === accent).every(n => !!n.props?.dimColor === (state === 'done')), `${state} worker ${i} ${part} dim`).toBe(true)
      }
      if (surface === 'desktop') {
        const box = all.find(n => n.props?.key === `desktop-worker-${i}`)!
        expect(box.props?.borderColor).toBe(accent)
        expect(box.props?.backgroundColor).toBe(tint ?? '#1a1a1a')
      } else {
        const row = nodes(drawnNode(`hide-worker-${i}-top-space`))
        expect(row.some(n => n.props?.backgroundColor === tint && n.props?.color === accent), `${state} worker ${i} tint`).toBe(true)
      }
      const badges = nodes(title).filter(n => text(n).includes('sonnet'))
      expect(badges.some(n => n.props?.backgroundColor === '#3a3a3a' && n.props?.color === '#a0a0a0'), `${state} worker ${i} badge`).toBe(true)
    }
    expect(JSON.stringify(tree)).not.toMatch(/#(?:ffab91|f2c79b|c9a7ff|8ecbff|ff9ecb|7fe0c8|a8b4ff|9fe3f0)/i)
    warning = true
    await report($, input(state, true)); await ui.redraw()
    if (surface === 'desktop') await ui.advance(32)
    const warned = nodes(await paneTree(ui))
    for (let i = 0; i < roles.length; i++) expect(nodes(warned.find(n => n.props?.key === `hide-worker-${i}-status`)).map(n => n.props?.color)).toContain('#ffcf5a')
  }
  await ui.unmount()
})
