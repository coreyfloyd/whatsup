import { paneTree, desktopPane } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import { reportError } from '../hooks/report'
import { cells } from '../hooks/session-facts'
import type { On } from 'claude-code'
import { mergeWorkers, tokenGraph, workerLines } from '../hooks/workers'
import type { LiveWorker } from '../hooks/workers'

// Derived scenarios for S3 of the approved public-release spec, not live telemetry.
const worker: LiveWorker = { name: 'generator', role: 'gen-runtime', status: 'generating', state: 'running', model: 'claude-sonnet-5-5', started: 0, changed: 0, minutes: { 0: 1000, 1: 2000 }, total: 3000, context: { tokens: 170000, window: 200000 }, source: 'observed' }
const main: LiveWorker = { ...worker, name: 'session', role: 'main', minutes: {}, total: undefined }
const output = (lines: ReturnType<typeof workerLines>) => lines.map(l => (l.prefix ?? '') + l.parts.map(p => p.text).join('') + (l.suffix ?? '')).join('\n')
function host(on: On) {
  const clock = mock.clock(on), store = new Map<string, unknown>()
  on('session.id', () => ({ value: 'report-session' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('session.model', () => ({ value: worker.model! }))
  on('session.usage', () => ({ value: { context: { tokens: 1000, window: 200000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: [] }))
  on('settings.read', () => ({ value: { prefersReducedMotion: true } }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', () => ({ value: false }))
  on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: { tool: 'mcp__whatsup__report' } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  return { clock, store }
}
const nodes = (node: any): any[] => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(nodes)]
const text = (node: any): string => typeof node === 'string' ? node : (node?.children ?? []).map(text).join('')
describe('workers', () => {
  test('merges by name, preserves observation facts and keeps main first', () => {
    const merged = mergeWorkers([main, worker], [{ name: worker.name, role: 'other', status: 'reviewing', state: 'waiting', task: 'Review workers', model: 'untrusted' }, { name: 'remote', role: 'test', status: 'testing', state: 'running' }], [], 60000)
    expect(merged.map(w => w.name)).toEqual(['session', 'generator', 'remote'])
    expect(merged[1]!.model).toBe(worker.model)
    expect(merged[1]!.role).toBe(worker.role)
    expect(merged[1]!.status).toBe('reviewing')
    expect(merged[1]!.task).toBe('Review workers')
    expect(merged[1]!.source).toBe('both')
  })
  test('terminal transitions dim for exactly ten minutes without resetting on repeat', () => {
    const done = [{ name: worker.name, role: worker.role, status: 'done', state: 'done' as const }]
    const first = mergeWorkers([main, worker], done, [], 60000)
    expect(first[1]!.changed).toBe(60000)
    const repeat = mergeWorkers([main, worker], done, first, 659999)
    expect(repeat).toHaveLength(2)
    expect(output(workerLines(repeat, 80, 659999, false))).toContain('✅ done')
    expect(workerLines(repeat, 80, 659999, false).filter(l => l.key.startsWith('worker-1')).every(l => l.parts.every(p => p.dim))).toBe(true)
    expect(mergeWorkers([main, worker], done, first, 660000)).toHaveLength(1)
    expect(mergeWorkers([main, { ...worker, state: 'failed', changed: 0 }], [], [], 600000)).toHaveLength(1)
  })
  test('matching report supplies a 10,000-token window while observation owns tokens', () => {
    // Reproduction from the reported-window acceptance criteria; not live telemetry.
    const observed = { ...worker, context: { tokens: 3000 } }
    const report = { name: worker.name, role: worker.role, status: worker.status, state: worker.state, context: { tokens: 9000, window: 10000 } }
    expect(reportError({ scope: 'Show workers', workers: [report] })).toBe(null)
    const merged = mergeWorkers([observed], [report], [], 60000)
    expect(merged[0]!.context).toEqual({ tokens: 3000, window: 10000 })
    for (const columns of [40, 80]) expect(output(workerLines(merged, columns, 60000, false))).toContain('▰▰▱▱▱▱ 30%')
    expect(observed.context).toEqual({ tokens: 3000 })
    expect(mergeWorkers([observed], [], merged, 60000)[0]!.context).toEqual({ tokens: 3000 })
    expect(mergeWorkers([observed], [{ ...report, name: 'different' }], [], 60000)[0]!.context).toEqual({ tokens: 3000 })
  })
  test('measured context wins over a matching report including zero measured tokens', () => {
    const report = { name: worker.name, role: worker.role, status: worker.status, state: worker.state, context: { tokens: 9000, window: 10000 }, total: 99999, tokens: [99999] }
    const merged = mergeWorkers([{ ...worker, context: { tokens: 0, window: 200000 } }], [report], [], 60000)
    expect(merged[0]!.context).toEqual({ tokens: 0, window: 200000 })
    expect(merged[0]!.total).toBe(worker.total)
    expect(merged[0]!.minutes).toEqual(worker.minutes)
    expect(output(workerLines(merged, 40, 60000, false))).toContain('▱▱▱▱▱▱ 0%')
  })
  test('relative scale, minute window, gaps, in-flight dip and reduced-motion still', () => {
    const active = { ...worker, minutes: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, 4000])), inFlight: true }
    for (const width of [23, 63]) {
      const graph = tokenGraph(active, width, 39 * 60000, false)
      expect(graph.length).toBe(Math.min(40, width))
      expect(graph.endsWith('▇')).toBe(true)
      expect(tokenGraph(active, width, 39 * 60000, true).endsWith('█')).toBe(true)
    }
    expect(tokenGraph({ ...worker, minutes: { 0: 1000, 2: 2000 } }, 23, 120000, false)).toBe('▄ █')
    expect(tokenGraph({ ...worker, minutes: {} }, 23, 60000, false)).toBe('')
  })
  test('scales low and very high minutes linearly within the visible window', () => {
    // Boundary scenarios required by the graph-scale acceptance criteria.
    const history = { ...worker, minutes: { 0: 1000, 1: 187500, 2: 375000, 3: 750000, 4: 1500000 } }
    expect(tokenGraph(history, 5, 4 * 60000, true)).toBe('▁▁▂▄█')
    expect(tokenGraph({ ...worker, minutes: { 0: 1500000, 1: 1000, 2: 2000 } }, 2, 2 * 60000, true)).toBe('▄█')
    expect(tokenGraph({ ...worker, minutes: { 0: 1000, 1: 2000, 2: 1500000 } }, 2, 60000, false)).toBe('▄█')
  })
  test('equal nonzero minutes fill the scale and zero-only windows stay blank', () => {
    for (const tokens of [1000, 1500000]) {
      expect(tokenGraph({ ...worker, minutes: { 0: tokens, 1: tokens, 2: tokens } }, 3, 120000, true)).toBe('███')
    }
    expect(tokenGraph({ ...worker, minutes: { 0: 0, 1: 0 } }, 2, 60000, true)).toBe('  ')
    expect(tokenGraph({ ...worker, minutes: { 0: 1500000 } }, 2, 120000, false)).toBe('  ')
    expect(tokenGraph(worker, 0, 60000, true)).toBe('')
  })
  test('waiting and terminal graphs scale only through their transition minute', () => {
    for (const state of ['waiting', 'done', 'failed'] as const) {
      expect(tokenGraph({ ...worker, state, changed: 60000, minutes: { 0: 1000, 1: 2000, 2: 1500000 } }, 3, 120000, false)).toBe('▄█')
    }
  })
  for (const columns of [40, 80]) test(`expanded boxes fit ${columns} columns with task, usage and gauge`, () => {
    const rows = workerLines([{ ...worker, task: { title: 'Show workers', number: 13, link: 'https://github.com/example/project/issues/13', state: 'active' } }], columns, 60000, false)
    expect(rows.map(row => row.key)).toEqual(['agents', 'worker-0', 'worker-0-top-space', 'worker-0-task', 'worker-0-graph', 'worker-0-status-space', 'worker-0-status', 'worker-0-bottom'])
    for (const key of ['worker-0-top-space', 'worker-0-status-space']) {
      expect(output(rows.filter(row => row.key === key))).toBe('│' + ' '.repeat(columns - 2) + '│')
    }
    const rendered = output(rows)
    expect(rendered).toContain('🤖 Agents · 1 running')
    expect(rendered).toContain('3k tokens')
    expect(rendered).toContain('85%')
    expect(rendered).toContain('🐝 generating')
    expect(rows.some(l => l.parts.some(p => p.underline && p.text === '#13'))).toBe(true)
    expect(rows.some(l => l.parts.some(p => p.color === '#ffcf5a'))).toBe(true)
    for (const row of rows) expect(cells(output([row])) <= columns).toBe(true)
  })
  test('reported usage supplies its own context window and derives the total', () => {
    const report = { name: 'remote', role: 'testing', status: 'testing', state: 'running' as const, tokens: [1000, 2000], context: { tokens: 9000, window: 10000 } }
    expect(reportError({ scope: 'Show workers', workers: [report] })).toBe(null)
    const merged = mergeWorkers([main], [report], [], 60000)
    expect(merged[1]!.total).toBe(3000)
    expect(output(workerLines(merged, 40, 60000, false))).toContain('90%')
    expect(reportError({ scope: 'Show workers', workers: [{ ...report, context: { tokens: 1, window: 0 } }] })).toContain('window')
  })
  test('reduced-motion graph remains still across clock ticks', () => {
    expect(tokenGraph(worker, 23, 60000, true)).toBe(tokenGraph(worker, 23, 120000, true))
    expect(tokenGraph(worker, 23, 120000, false)).not.toBe(tokenGraph(worker, 23, 60000, false))
  })
  for (const columns of [40, 80]) test(`graph uses the available window and scrolls at ${columns} columns`, () => {
    const history = { ...worker, total: 128000, minutes: Object.fromEntries(Array.from({ length: 80 }, (_, i) => [i, (i % 8 + 1) * 1000])) }
    const line = workerLines([history], columns, 79 * 60000, false).find(l => l.key === 'worker-0-graph')!
    const expected = tokenGraph(history, columns - 17, 79 * 60000, false)
    expect(line.parts[0]!.text.startsWith(expected)).toBe(true)
    expect(expected.length).toBe(columns - 17)
    const next = tokenGraph(history, columns - 17, 80 * 60000, false)
    expect(next.slice(0, -1)).toBe(expected.slice(1))
  })
  test('report-time retention, task cards, replacement and session-first order cross the pane seam', async ($, on) => {
    const h = host(on)
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    const report = { scope: 'Show workers', workers: [{ name: 'remote', role: 'testing', status: 'done', state: 'done', task: { title: 'Show workers', number: 13, state: 'done', link: 'https://github.com/example/project/issues/13' } }] }
    await $.tool.call({ tool: 'mcp__whatsup__report', ...report })
    await h.clock.advance(599999)
    const ui = desktopPane(await $.ui.mount({ plugin: 'whatsup', surface: 'desktop', component: 'Pane', requestId: 'session-status', props: { title: 'whatsup', bodyColumns: 40, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }, viewport: { columns: 80, rows: 46, isFullscreen: true } }))
    const tree = await paneTree(ui)
    expect(text(tree)).toContain('testing · remote')
    expect(nodes(nodes(tree).find(n => n.props?.key === 'hide-worker-1-task-rest')).some(n => n.props?.dimColor)).toBe(true)
    await ui.press({ key: 'show-worker-1-task' })
    expect(text(await paneTree(ui))).toContain('open ↗')
    await $.tool.call({ tool: 'mcp__whatsup__report', ...report })
    await h.clock.advance(1)
    await $.tool.call({ tool: 'mcp__whatsup__report', ...report })
    expect(text(await paneTree(ui))).not.toContain('testing · remote')
    await $.tool.call({ tool: 'mcp__whatsup__report', ...{ scope: 'Show workers' } })
    expect(text(await paneTree(ui))).toContain('main · session')
    expect(text(await paneTree(ui))).not.toContain('testing · remote')
  })
  test('configured status emoji is used', () => {
    expect(output(workerLines([worker], 40, 0, false, { generating: '✦' }))).toContain('✦ generating')
  })
  test('engine spawn and requests populate pane without a report and accumulate by minute', async ($, on) => {
    const h = host(on)
    on('agent.spawn', () => ({ agentId: 'worker-id', model: worker.model! }))
    on('turn.step', async function* (_$, e) { return ({ turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: worker.model!, input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 200, cache_creation_input_tokens: 300 } }) })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await $.agent.spawn({ tool_use_id: 'spawn-workers', provider: { plugin: 'engine', tier: 'core' }, parentModel: worker.model!, background: true, fork: false, prompt: 'Show workers', description: 'Show workers', name: worker.name, subagentType: worker.role })
    for await (const _ of $.turn.step({ turnId: 'turn', index: 0, model: worker.model!, messageCount: 1, agentId: 'worker-id' })) {}
    await h.clock.advance(60000)
    for await (const _ of $.turn.step({ turnId: 'turn', index: 1, model: worker.model!, messageCount: 2, agentId: 'worker-id' })) {}
    const ui = await $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status', props: { title: 'whatsup', bodyColumns: 80, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }, viewport: { columns: 120, rows: 46, isFullscreen: true } })
    const rendered = text(await paneTree(ui))
    expect(rendered).toContain('gen-runtime · generator')
    expect(rendered).toContain('3.2k tokens')
    expect(rendered).toContain('▱▱▱▱▱▱ 1%')
    expect(rendered.indexOf('main ·')).toBeLessThan(rendered.indexOf('gen-runtime ·'))
    expect(JSON.stringify([...h.store.values()])).toContain('1600')
  })
})
