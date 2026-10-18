import { paneTree } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import { registerEnrichment } from '../hooks/enrichment'
import { reportLines } from '../hooks/report-layout'

const identity = 'example/project#1'
// Derived display fixture from github-capture.json issue 1, with an active report override.
const reported = { scope: 'work', sections: [{ label: 'Work', verb: 'closed', item_kind: 'tickets', items: [{ title: 'old', identity, state: 'active' }] }] }
const enriched = { scope: 'work', sections: [{ ...reported.sections[0], items: [{ ...reported.sections[0]!.items[0], title: 'Plan Session Status initial build', number: 1, link: 'https://github.com/example/project/issues/1', enrichment: { state: 'present', value: { status: 'closed', labels: ['type/enhancement'], blockers: [], page: 'https://github.com/example/project/issues/1' } } }] }] }
function setup(on: any) {
  const store = new Map(); const calls: any[] = []; const response = { exitCode: 0, stdout: JSON.stringify({ report: enriched, off_reason: null }), stderr: '', isStdoutTruncated: false, isStderrTruncated: false }
  on('store.get', (_$: any, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_$: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.cwd', () => ({ value: '/tmp' }))
  on('session.id', () => ({ value: 'enrichment-session' }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('process.run', (_$: any, e: any) => {
    calls.push(e)
    return { value: response }
  })
  return { store, calls, response }
}
const open = ($: any) => $.command.run({ command: 'session-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
const mount = ($: any) => $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status', props: { title: 'whatsup', bodyColumns: 80, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }, viewport: { columns: 120, rows: 46, isFullscreen: true } })
function text(node: any): string { return typeof node === 'string' ? node : (node?.children ?? []).map(text).join('') }

describe('GitHub reader bridge', () => {
  test('runs bundled Python with JSON on open and refreshes every 60 seconds', async ($, on) => {
    const clock = mock.clock(on)
    const h = setup(on)
    await $.tool.call({ tool: 'mcp__whatsup__report', ...reported })
    expect(h.calls).toHaveLength(0)
    await open($)
    expect(h.calls).toHaveLength(1)
    expect(h.calls[0].argv[0]).toBe('python3')
    expect(h.calls[0].argv[1]).toContain('reader')
    expect(JSON.parse(h.calls[0].init.stdin).report).toEqual(reported)
    const ui = await mount($)
    await ui.press({ key: 'expand-section-0' })
    expect(text(await paneTree(ui))).toContain('Plan Session Status initial build')
    await ui.press({ key: 'show-section-0-item-0' })
    expect(text(await paneTree(ui))).toContain('Status: closed')
    expect(text(await paneTree(ui))).toContain('type/enhancement')
    await clock.advance(59999); expect(h.calls).toHaveLength(1)
    await clock.advance(1); expect(h.calls).toHaveLength(2)
  })
  test('close cancels the open pane timer', async () => {
    const hooks: Record<string, Function> = {}; let cancelled = 0
    const store = new Map<string, any>(); store.set('context-report:session', reported)
    const host: any = { session: { id: async () => 'session' },
      store: { get: async (key: string) => store.get(key), set: async (key: string, value: any) => store.set(key, value) },
      clock: { every: () => ({ cancel: () => { cancelled++ } }) },
      process: { run: async () => ({ exitCode: 0, stdout: JSON.stringify({ report: enriched, off_reason: null }) }) },
      plugin: { root: '/plugin' }, ui: { invalidate: () => {} } }
    registerEnrichment(((name: string, ...args: any[]) => { hooks[name] = args.at(-1); return { catch: () => {} } }) as any, false)
    await hooks['ui.open']!(host, { id: 'session-status' }, async () => {})
    expect(cancelled).toBe(0)
    await hooks['ui.close']!(host, { id: 'session-status' }, async () => {})
    expect(cancelled).toBe(1)
  })
  test('reader failures, truncated or partial JSON never show zero counts or secrets', async ($, on) => {
    mock.clock(on)
    const h = setup(on)
    await $.tool.call({ tool: 'mcp__whatsup__report', ...reported })
    const ui = await mount($)
    for (const change of [
      { exitCode: 1, stderr: 'private credential' },
      { exitCode: 0, stdout: 'broken' },
      { exitCode: 0, stdout: JSON.stringify({ report: { scope: 'work' }, off_reason: null }) },
      { exitCode: 0, stdout: JSON.stringify({ report: enriched, off_reason: null }), isStdoutTruncated: true },
    ]) {
      Object.assign(h.response, { isStdoutTruncated: false }, change)
      await open($)
      const drawn = text(await paneTree(ui))
      expect(drawn).toContain("Couldn't load")
      expect(drawn).not.toContain('0/1')
      expect(drawn).not.toContain('private credential')
    }
  })
  test('no access falls back to report with exactly one dim off line', async ($, on) => {
    mock.clock(on)
    const h = setup(on)
    h.response.stdout = JSON.stringify({ report: reported, off_reason: 'GitHub enrichment is off: no token.' })
    await $.tool.call({ tool: 'mcp__whatsup__report', ...reported })
    await open($)
    const ui = await mount($)
    await ui.press({ key: 'expand-section-0' })
    const drawn = text(await paneTree(ui))
    expect(drawn.split('enrichment is off')).toHaveLength(2)
    expect(drawn).toContain('old')
    expect(drawn).toContain('0/1 closed')
  })
  test('configured item kinds select GitHub counting without depending on section labels', { options: { githubIssueKinds: 'work items' } }, async ($, on) => {
    mock.clock(on)
    const h = setup(on)
    await $.tool.call({ tool: 'mcp__whatsup__report', ...reported })
    await open($)
    expect(JSON.parse(h.calls[0].init.stdin).issue_kinds).toEqual(['work items'])
  })
  test('unavailable items suppress section zero counts and render grey warning and reason', () => {
    const report: any = structuredClone(reported)
    report.sections[0].items[0].enrichment = { state: 'unavailable', reason: 'partial' }
    const lines = reportLines(report, 80, [0])
    const rendered = lines.map(line => line.parts.map(p => p.text).join('') + (line.suffix ?? '')).join('\n')
    expect(rendered).toContain("Couldn't load")
    expect(rendered).toContain('partial')
    expect(rendered).not.toContain('0/1')
    expect(rendered).not.toContain('0%')
    expect(lines.find(line => line.key === 'section-0-item-0')?.parts.every(p => p.dim && p.color === '#808080')).toBe(true)
    expect(lines.filter(line => line.key.startsWith('section-0')).every(line => line.unavailable)).toBe(true)
  })
})
