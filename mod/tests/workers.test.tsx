import { paneTree, desktopPane } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import { reportError } from '../hooks/report'
import { cells } from '../hooks/session-facts'
import type { On } from 'claude-code'
import { brailleCell as cell, mergeWorkers, tokenGraph, workerLines } from '../hooks/workers'
import type { LiveWorker } from '../hooks/workers'

// Derived scenarios for S3 of the approved public-release spec, not live telemetry.
const worker: LiveWorker = { name: 'generator', role: 'gen-runtime', status: 'generating', state: 'running', model: 'claude-sonnet-5-5', started: 0, changed: 0, minutes: { 0: 1000, 1: 2000 }, total: 3000, context: { tokens: 170000, window: 200000 }, source: 'observed' }
const main: LiveWorker = { ...worker, name: 'session', role: 'main', minutes: {}, total: undefined }
const output = (lines: ReturnType<typeof workerLines>) => lines.map(l => (l.prefix ?? '') + l.parts.map(p => p.text).join('') + (l.suffix ?? '')).join('\n')
function host(on: On, agents: () => unknown[] = () => []) {
  const clock = mock.clock(on), store = new Map<string, unknown>()
  on('session.id', () => ({ value: 'report-session' }))
  on('session.cwd', () => ({ value: '/project' }))
  on('session.model', () => ({ value: worker.model! }))
  on('session.usage', () => ({ value: { context: { tokens: 1000, window: 200000 }, rateLimits: [] } }))
  on('agent.list', () => ({ value: agents() as any }))
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
  test('braille cells fill bottom-up, two minutes per cell', () => {
    expect([cell(0, 0), cell(1, 1), cell(4, 4), cell(2, 4), cell(0, 3)]).toEqual(['\u2800', '⣀', '⣿', '⣼', '⢰'])
  })
  test('relative scale, two-minute cells, solid baseline, in-flight dip and reduced-motion still', () => {
    const active = { ...worker, minutes: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i, 4000])), inFlight: true }
    for (const width of [23, 63]) {
      const graph = tokenGraph(active, width, 39 * 60000, false)
      expect(graph.length).toBe(20)
      expect(graph.endsWith(cell(4, 3))).toBe(true)
      expect(tokenGraph(active, width, 39 * 60000, true).endsWith(cell(4, 4))).toBe(true)
    }
    // An idle minute between bursts draws the baseline instead of a gap.
    expect(tokenGraph({ ...worker, minutes: { 0: 1000, 2: 2000 } }, 23, 120000, false)).toBe(cell(0, 2) + cell(1, 4))
    expect(tokenGraph({ ...worker, minutes: {} }, 23, 60000, false)).toBe('')
  })
  test('scales low and very high minutes linearly within the visible window', () => {
    // Boundary scenarios required by the graph-scale acceptance criteria.
    const history = { ...worker, minutes: { 0: 1000, 1: 187500, 2: 375000, 3: 750000, 4: 1500000 } }
    expect(tokenGraph(history, 5, 4 * 60000, true)).toBe(cell(0, 1) + cell(1, 1) + cell(2, 4))
    expect(tokenGraph({ ...worker, minutes: { 0: 1500000, 1: 1000, 2: 2000 } }, 1, 2 * 60000, true)).toBe(cell(2, 4))
    expect(tokenGraph({ ...worker, minutes: { 0: 1000, 1: 2000, 2: 1500000 } }, 1, 60000, false)).toBe(cell(2, 4))
  })
  test('equal nonzero minutes fill the scale and zero-only windows draw the baseline', () => {
    for (const tokens of [1000, 1500000]) {
      expect(tokenGraph({ ...worker, minutes: { 0: tokens, 1: tokens, 2: tokens } }, 2, 120000, true)).toBe(cell(0, 4) + cell(4, 4))
    }
    expect(tokenGraph({ ...worker, minutes: { 0: 0, 1: 0 } }, 1, 60000, true)).toBe(cell(1, 1))
    expect(tokenGraph({ ...worker, minutes: { 0: 1500000 } }, 1, 120000, false)).toBe(cell(1, 1))
    expect(tokenGraph(worker, 0, 60000, true)).toBe('')
  })
  test('waiting and terminal graphs scale only through their transition minute', () => {
    for (const state of ['waiting', 'done', 'failed'] as const) {
      expect(tokenGraph({ ...worker, state, changed: 60000, minutes: { 0: 1000, 1: 2000, 2: 1500000 } }, 2, 120000, false)).toBe(cell(2, 4))
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
    const history = { ...worker, total: 128000, minutes: Object.fromEntries(Array.from({ length: 160 }, (_, i) => [i, (i % 8 + 1) * 1000])) }
    const line = workerLines([history], columns, 159 * 60000, false).find(l => l.key === 'worker-0-graph')!
    const expected = tokenGraph(history, columns - 17, 159 * 60000, false)
    expect(line.parts[0]!.text.startsWith(expected)).toBe(true)
    expect(expected.length).toBe(columns - 17)
    // Two minutes later the window has moved by one whole cell.
    const next = tokenGraph(history, columns - 17, 161 * 60000, false)
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
  // Engine 2.1.318 lists a finished named subagent as `idle`; a teammate kept alive reads `waiting`.
  const mount = ($: any) => $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status', props: { title: 'whatsup', bodyColumns: 80, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }, viewport: { columns: 120, rows: 46, isFullscreen: true } })
  test('listed agents this session never saw are not adopted unless running', async ($, on) => {
    const previous = [{ id: 'old-1', name: 'rss', description: 'Old teammate', type: 'teammate', status: 'idle' }, { id: 'old-2', name: 'comms', description: 'Old teammate', type: 'teammate', status: 'waiting' }, { id: 'old-3', name: 'vqa', description: 'Old subagent', type: 'Explore', status: 'completed' }]
    let listed = previous
    const h = host(on, () => listed)
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    for (const next of [previous, [...previous, { id: 'live', name: 'harness1', description: 'Live teammate', type: 'teammate', status: 'running' }]]) {
      listed = next
      const ui = await mount($)
      const rendered = text(await paneTree(ui))
      expect(rendered).toContain('main · session')
      for (const name of ['rss', 'comms', 'vqa']) expect(rendered).not.toContain(name)
      expect(rendered.includes('teammate · harness1')).toBe(listed.length > previous.length)
      expect(JSON.stringify([...h.store.values()])).not.toContain('old-')
      if (listed === previous) await ui.unmount()
    }
  })
  test('a completed turn stays done through list refreshes and retires after ten minutes', async ($, on) => {
    let status = 'running'
    const h = host(on, () => [{ id: 'worker-id', name: worker.name, description: 'Show workers', type: worker.role, status }])
    on('agent.spawn', () => ({ agentId: 'worker-id', model: worker.model! }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await $.agent.spawn({ tool_use_id: 'spawn-workers', provider: { plugin: 'engine', tier: 'core' }, parentModel: worker.model!, background: true, fork: false, prompt: 'Show workers', description: 'Show workers', name: worker.name, subagentType: worker.role })
    await h.clock.advance(60000)
    // Each check mounts afresh so the render reruns the list refresh.
    const render = async () => { const ui = await mount($); const rendered = text(await paneTree(ui)); await ui.unmount(); return rendered }
    expect(await render()).toContain('🐝 generating')
    await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 'turn', agentId: 'worker-id', reason: 'answer' })
    for (const word of ['idle', 'waiting']) {
      status = word
      const rendered = await render()
      expect(rendered).toContain('gen-runtime · generator')
      expect(rendered.slice(rendered.indexOf('gen-runtime · generator'))).toContain('✅ done')
      expect(rendered.slice(rendered.indexOf('gen-runtime · generator'))).not.toContain('🪑 waiting')
    }
    await h.clock.advance(599999)
    expect(await render()).toContain('✅ done')
    await h.clock.advance(1)
    expect(await render()).not.toContain('gen-runtime · generator')
  })
  test('a request in flight stays running when the list snapshot says idle', async ($, on) => {
    let status = 'running', release = () => {}, started = () => {}
    const h = host(on, () => [{ id: 'worker-id', name: worker.name, description: 'Show workers', type: worker.role, status }])
    const render = async () => { const ui = await mount($); const rendered = text(await paneTree(ui)); await ui.unmount(); const box = rendered.indexOf('gen-runtime · generator'); return box < 0 ? '' : rendered.slice(box) }
    on('agent.spawn', () => ({ agentId: 'worker-id', model: worker.model! }))
    on('turn.complete', (_$, e) => ({ text: e.answer }))
    on('turn.step', async function* (_$, e) {
      started()
      await new Promise<void>(resolve => { release = resolve })
      return ({ turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: { model: worker.model!, input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } })
    })
    // Starts a request and returns once it streams; the returned promise ends it.
    const request = async (turnId: string) => {
      const streaming = new Promise<void>(resolve => { started = resolve })
      const done = (async () => { for await (const _ of $.turn.step({ turnId, index: 0, model: worker.model!, messageCount: 1, agentId: 'worker-id' })) {} })()
      await streaming
      return async () => { release(); await done }
    }
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await $.agent.spawn({ tool_use_id: 'spawn-workers', provider: { plugin: 'engine', tier: 'core' }, parentModel: worker.model!, background: true, fork: false, prompt: 'Show workers', description: 'Show workers', name: worker.name, subagentType: worker.role })
    expect(await render()).toContain('🐝 generating')
    // A running worker whose list status turns idle mid-request stays running.
    let end = await request('turn')
    status = 'idle'
    expect(await render()).toContain('🐝 generating')
    await end()
    // A done worker reopened by a new request stays running against the stale idle snapshot, during and after the request.
    await $.turn.complete({ answer: 'Done', durationMs: 1, isAborted: false, turnId: 'turn', agentId: 'worker-id', reason: 'answer' })
    expect(await render()).toContain('✅ done')
    await h.clock.advance(60000)
    end = await request('turn-2')
    expect(await render()).toContain('🐝 generating')
    await end()
    expect(await render()).toContain('🐝 generating')
    // A later change in the list's own status still applies.
    status = 'running'
    await render()
    status = 'idle'
    expect(await render()).toContain('🪑 waiting')
  })
})
