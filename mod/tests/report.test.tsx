import { decision } from './fixtures/decision'
import { paneTree, desktopPane } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import { cells } from '../hooks/session-facts'
import { resolveConfig } from '../hooks/templates'
import { decisionVersion, reportArguments } from '../hooks/report'
import { REFRESH_TEXT, answersKey, inputUnavailableKey } from '../hooks/decision-input'
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

describe('context report', () => {
  for (const surface of ['terminal', 'desktop'] as const) {
    for (const columns of [40, 58, 80]) test(`discussion is explicit, preserves provenance and permits later answering at ${columns} on ${surface}`, async ($, on) => {
      host(on); const inputs: any[] = []
      on('prompt.submit', (_$, e) => { inputs.push(e); return { text: e.text, origin: e.origin } })
      await start($); const input = { scope: 'Design pending decisions', decisions: [decision] }
      await report($, input); const ui = await mount($, surface, columns)
      expect(inputs).toHaveLength(0)
      await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'select-decision-0-0' })
      expect(inputs).toHaveLength(0)
      await ui.press({ key: 'discuss-decision-0' })
      expect(inputs).toHaveLength(1)
      expect(inputs[0].origin).toEqual({ kind: 'plugin', name: 'whatsup' })
      const payload = JSON.parse(inputs[0].text)
      expect(payload.decision).toEqual({ identity: decision.identity, question: decision.question })
      expect(payload.action).toContain('Discussion request')
      expect(payload.action).toContain('missing explanation')
      expect(payload.action).toContain('alternative')
      expect(payload.answer).toBeUndefined()
      expect(inputs[0].text).not.toContain(decision.options[0].label)
      expect(await drawn(ui)).toContain('Discussion requested')
      expect(await ui.find({ key: 'discuss-decision-0' })).toBeDefined()
      expect(await drawn(ui)).not.toContain('Sent — awaiting agent')
      await ui.press({ key: 'send-decision-0' })
      expect(inputs).toHaveLength(2)
      expect(await drawn(ui)).toContain('Sent — awaiting agent')
      await report($, { scope: input.scope })
      expect(await drawn(ui)).not.toContain(decision.question)
    })
    test(`unconfirmed discussion persists without locking answers on ${surface}`, async ($, on) => {
      const h = host(on); let calls = 0; let finish!: (v: any) => void; let submitted: any
      on('prompt.submit', (_$, e) => { calls++; submitted = e; return new Promise(resolve => { finish = resolve }) })
      await start($); const input = { scope: 'Design pending decisions', decisions: [decision] }
      await report($, input); let ui = await mount($, surface)
      await ui.press({ key: 'expand-decision-0' })
      await Promise.all([ui.press({ key: 'discuss-decision-0' }), ui.press({ key: 'discuss-decision-0' })])
      expect(calls).toBe(1)
      expect(await drawn(ui)).toContain('Requesting discussion')
      await h.clock.advance(15000)
      expect(await drawn(ui)).toContain('Discussion unconfirmed')
      await ui.unmount(); await start($); await report($, input); ui = await mount($, surface)
      expect(await drawn(ui)).toContain('Discussion unconfirmed')
      expect(await drawn(ui)).toContain('continue manually')
      await ui.press({ key: 'expand-decision-0' })
      expect(await ui.find({ key: 'discuss-decision-0' })).toBeUndefined()
      await ui.press({ key: 'select-decision-0-1' })
      expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
      expect(await drawn(ui)).toContain('Discussion unconfirmed')
      finish({ text: submitted.text, origin: submitted.origin }); await ui.redraw()
      expect(await drawn(ui)).toContain('Discussion requested')
      expect(calls).toBe(1)
      await report($, { ...input, decisions: [{ ...decision, context: decision.context + ' Revised.' }] })
      expect(await drawn(ui)).not.toContain('Discussion requested')
    })
  }
  test('discussion ambiguity, restart, late refusal and session isolation stay independent of answers', async ($, on) => {
    const h = host(on); let finish!: (v: any) => void; let calls = 0
    on('prompt.submit', () => { calls++; return new Promise(resolve => { finish = resolve }) })
    await start($); const input = { scope: 'Design pending decisions', decisions: [decision] }
    await report($, input); const ui = await mount($)
    await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'discuss-decision-0' })
    await start($)
    expect(await drawn(ui)).toContain('Discussion unconfirmed')
    finish({ drop: 'Later confirmed refusal' }); await ui.redraw()
    await ui.press({ key: 'expand-decision-0' })
    expect(await drawn(ui)).toContain('Discussion not sent: Later confirmed refusal')
    await ui.press({ key: 'discuss-decision-0' })
    finish({ text: 'Unmatched response', origin: { kind: 'plugin', name: 'whatsup' } }); await ui.redraw()
    expect(await drawn(ui)).toContain('Discussion unconfirmed')
    expect(await ui.find({ key: 'discuss-decision-0' })).toBeUndefined()
    await ui.press({ key: 'select-decision-0-0' }); await ui.press({ key: 'send-decision-0' })
    expect(calls).toBe(3)
    expect(await drawn(ui)).toContain('Sending answer')
    finish({ drop: 'Policy refused this input' }); await ui.redraw()
    h.session('different-session'); await start($)
    expect(await drawn(ui)).not.toContain(decision.question)
  })
  test('ambiguous discussion result never retries automatically', async ($, on) => {
    const h = host(on); let calls = 0
    on('prompt.submit', (_$, e) => { calls++; return { text: 'Unmatched response', origin: e.origin } })
    await start($); await report($, { scope: 'Design pending decisions', decisions: [decision] })
    const ui = await mount($); await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'discuss-decision-0' })
    expect(await drawn(ui)).toContain('Discussion unconfirmed')
    await h.clock.advance(60000); await ui.redraw()
    expect(calls).toBe(1)
    await ui.press({ key: 'select-decision-0-0' })
    expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
  })
  for (const field of ['context', 'removed'] as const) test(`stale discussion press is refused after ${field} changes`, async ($, on) => {
    host(on); let calls = 0; let release!: () => void
    on('prompt.submit', (_$, e) => { calls++; return { text: e.text, origin: e.origin } })
    on('ui.press', { element: 'discuss-decision-0' }, async (_$, e, next) => {
      await new Promise<void>(resolve => { release = resolve }); return next(e)
    })
    await start($); const input = { scope: 'Design pending decisions', decisions: [decision] }
    await report($, input); const ui = await mount($); await ui.press({ key: 'expand-decision-0' })
    const pressed = ui.press({ key: 'discuss-decision-0' })
    while (!release) await Promise.resolve()
    await report($, field === 'removed' ? { scope: input.scope } : { ...input, decisions: [{ ...decision, context: decision.context + ' Revised.' }] })
    release(); await pressed
    expect(calls).toBe(0)
  })
  test('discussion refusal permits retry and unsupported input disables both actions', async ($, on) => {
    host(on); let unsupported = false
    on('prompt.submit', () => { if (unsupported) throw Error('no implementation for prompt.submit'); return { drop: 'Policy refused this input' } })
    await start($); await report($, { scope: 'Design pending decisions', decisions: [decision] })
    const ui = await mount($); await ui.press({ key: 'expand-decision-0' })
    await ui.press({ key: 'discuss-decision-0' })
    expect(await drawn(ui)).toContain('Discussion not sent: Policy refused this input')
    expect(await ui.find({ key: 'discuss-decision-0' })).toBeDefined()
    unsupported = true; await ui.press({ key: 'discuss-decision-0' })
    expect(await drawn(ui)).toContain('submission unavailable')
    expect(await ui.find({ key: 'discuss-decision-0' })).toBeUndefined()
    await ui.press({ key: 'select-decision-0-0' })
    expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
  })

  test('decision validation is atomic and omission withdraws the collection', async ($, on) => {
    const h = host(on); await start($)
    const good = { scope: 'Keep this', decisions: [decision] }
    expect(await report($, good)).toEqual({ result: 'Context report replaced.' })
    for (const [decisions, field] of [
      [[{ ...decision, question: '  ' }], 'question'],
      [[{ ...decision, why_now: '' }], 'why_now'],
      [[{ ...decision, context: '' }], 'context'],
      [[{ ...decision, identity: '' }], 'identity'],
      [[{ ...decision, options: [decision.options[0]] }], 'options'],
      [[decision, decision], 'identity'],
      [[{ ...decision, options: [decision.options[0], decision.options[0]] }], 'identity'],
      [[{ ...decision, options: [{ ...decision.options[0], cost: '' }, decision.options[1]] }], 'cost'],
      [[{ ...decision, recommendation: { option: 'absent', reason: 'Readability' } }], 'recommendation.option'],
      [[{ ...decision, recommendation: { option: 'one', reason: '' } }], 'reason'],
      [[{ ...decision, extra: true }], 'extra'],
    ] as const) {
      expect(JSON.stringify(await report($, { scope: 'bad', decisions }))).toContain(field)
      expect(h.store.get('context-report:report-session')).toEqual(good)
    }
    await report($, { scope: 'Withdrawn' })
    expect(h.store.get('context-report:report-session')).toEqual({ scope: 'Withdrawn' })
  })
  for (const columns of [80, 58, 40]) for (const placement of ['dock', 'inline'] as const) {
    test(`decision reading, paging and previews at ${columns}, ${placement}`, async ($, on) => {
      const h = host(on); await start($)
      const input = { scope: 'Design pending decisions in the pane', decisions: [decision, { ...decision, identity: 'second' }], sections: [section] }
      for (const surface of ['terminal'] as const) {
        await report($, input)
        const props = { title: 'whatsup', bodyColumns: columns, isFocused: true, placement, scroll: { offset: 0, bodyRows: 14 }, view: {} }
        const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status', props,
          viewport: { columns: columns + 40, rows: 46, isFullscreen: placement === 'dock' } })
        expect(await drawn(ui)).toContain('ANSWER NEEDED')
        expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
        await ui.press({ key: 'expand-decision-0' })
        let tree = await paneTree(ui)
        expect(text(tree)).toContain('WHY THIS MATTERS')
        expect(text(tree)).toContain('Recommended: Expand one at a time')
        const children = tree.children as Node[]
        expect(children.findIndex(n => n.props?.key === 'hide-session-bottom')).toBeLessThan(children.findIndex(n => n.props?.key === 'line-decision-0'))
        for (const row of children.filter(n => n.props?.position !== 'absolute')) expect(cells(text(row)) <= columns, text(row)).toBe(true)
        await ui.press({ key: 'expand-decision-1' })
        expect(await ui.find({ key: 'hide-decision-0-context-0' })).toBeUndefined()
        expect(await ui.find({ key: 'hide-decision-1-context-0' })).toBeDefined()
        await ui.press({ key: 'expand-decision-1' })
        expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
        await ui.press({ key: 'expand-decision-0' })
        await ui.press({ key: 'show-section-0' })
        tree = await paneTree(ui)
        const index = tree.children.findIndex((n: Node) => n.props?.key === 'line-section-0')
        await ui.redraw({ ...props, scroll: { offset: index, bodyRows: 14 } })
        tree = await paneTree(ui)
        const card = nodes(tree).find(n => n.props?.key === 'card-section-0')!
        const footer = nodes(tree).find(n => n.props?.key === 'overflow-controls')!
        expect(Number(card.props?.top)).toBeGreaterThanOrEqual(index)
        expect(Number(card.props?.top) + card.children!.length).toBeLessThanOrEqual(Number(footer.props?.top))
        await report($, input)
        expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
        await ui.press({ key: 'expand-decision-0' })
        await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
        expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
        await ui.unmount()
        const restored = await mount($, surface, columns)
        expect(await drawn(restored)).not.toContain('WHY THIS MATTERS')
        await restored.unmount()
        expect(h.opened.filter(argv => argv[0] === 'open')).toHaveLength(0)
      }
    })
  }
  test('same-session resume collapses decisions without losing reported content', async ($, on) => {
    host(on); await start($)
    await report($, { scope: 'Design pending decisions in the pane', decisions: [decision] })
    const ui = await mount($)
    await ui.press({ key: 'expand-decision-0' })
    expect(await drawn(ui)).toContain('WHY THIS MATTERS')
    await start($)
    expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
    expect(await drawn(ui)).toContain(decision.question)
  })
  test('closing the pane clears expansion; decisions are isolated to the engine session', async ($, on) => {
    const h = host(on); await start($)
    await report($, { scope: 'Design pending decisions in the pane', decisions: [decision] })
    let ui = await mount($)
    await ui.press({ key: 'expand-decision-0' })
    await ui.unmount()
    await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
    ui = await mount($)
    expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
    await ui.unmount()
    h.session('fresh-session')
    ui = await mount($)
    expect(await drawn(ui)).not.toContain('ANSWER NEEDED')
    await ui.unmount()
    h.session('report-session')
    ui = await mount($)
    expect(await drawn(ui)).toContain(decision.question)
    expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
  })
  for (const surface of ['terminal', 'desktop'] as const) for (const columns of [80, 58, 40]) {
    test(`explicit answer selection and persistent receipts at ${columns}, ${surface}`, async ($, on) => {
      const h = host(on); const inputs: any[] = []
      on('prompt.submit', (_$, e) => { inputs.push(e); return { text: e.text, origin: e.origin } })
      await start($)
      const input = { scope: 'Design pending decisions in the pane', decisions: [decision] }
      await report($, input)
      let ui = await mount($, surface, columns)
      await ui.press({ key: 'expand-decision-0' })
      expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
      await ui.press({ key: 'select-decision-0-0' })
      expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
      await ui.press({ key: 'select-decision-0-1' })
      await ui.press({ key: 'clear-decision-0' })
      expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
      expect(inputs).toHaveLength(0)
      await ui.press({ key: 'select-decision-0-0' })
      await ui.press({ key: 'send-decision-0' })
      expect(inputs).toHaveLength(1)
      expect(inputs[0].origin).toEqual({ kind: 'plugin', name: 'whatsup' })
      const payload = JSON.parse(inputs[0].text)
      expect(payload.decision).toEqual({ identity: decision.identity, question: decision.question })
      expect(payload.answer).toEqual(decision.options[0])
      expect(await drawn(ui)).toContain('Sent — awaiting agent')
      expect(await drawn(ui)).toContain(decision.options[0].label)
      expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
      if (surface === 'terminal') for (const row of (await paneTree(ui)).children.filter((n: Node) => n.props?.position !== 'absolute')) expect(cells(text(row)) <= columns, text(row)).toBe(true)
      await report($, input)
      await ui.unmount()
      await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
      await start($)
      ui = await mount($, surface, columns)
      expect(await drawn(ui)).toContain('Sent — awaiting agent')
      expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
      h.session('another-session'); await start($)
      expect(await drawn(ui)).not.toContain(decision.question)
      h.session('report-session')
      await report($, { ...input, decisions: [{ ...decision, context: decision.context + ' Revised.' }] })
      expect(await drawn(ui)).not.toContain('Sent — awaiting agent')
      await ui.press({ key: 'expand-decision-0' })
      expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
      await report($, { scope: input.scope })
      await report($, input)
      expect(await drawn(ui)).not.toContain('Sent — awaiting agent')
      expect(inputs).toHaveLength(1)
    })
  }
  test('refusal allows explicit retry; ambiguous delivery locks and survives resume', async ($, on) => {
    host(on); let calls = 0; let result: any = { drop: 'Policy refused this input' }
    on('prompt.submit', () => { calls++; return result })
    await start($); const input = { scope: 'Design pending decisions in the pane', decisions: [decision] }
    await report($, input); let ui = await mount($)
    await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'select-decision-0-0' })
    await ui.press({ key: 'send-decision-0' })
    expect(await drawn(ui)).toContain('Policy refused this input')
    expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
    result = { text: 'Unmatched response', origin: { kind: 'plugin', name: 'whatsup' } } // No confirmation of this answer.
    await ui.press({ key: 'send-decision-0' })
    expect(await drawn(ui)).toContain('Delivery unconfirmed')
    expect(await drawn(ui)).toContain(decision.options[0].label)
    expect(await drawn(ui)).toContain('continue there manually')
    expect(await drawn(ui)).not.toContain('WHY THIS MATTERS')
    await ui.unmount(); await start($); await report($, input); ui = await mount($)
    expect(await drawn(ui)).toContain('Delivery unconfirmed')
    await ui.press({ key: 'expand-decision-0' })
    expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
    expect(await ui.find({ key: 'select-decision-0-1' })).toBeUndefined()
    expect(calls).toBe(2)
  })
  test('rapid activation is single flight; late outcomes reconcile only their attempt', async ($, on) => {
    host(on); let calls = 0; let finish!: (v: any) => void
    on('prompt.submit', (_$, e) => { calls++; return new Promise(resolve => { finish = resolve }) })
    await start($); const input = { scope: 'Design pending decisions in the pane', decisions: [decision] }
    await report($, input); const ui = await mount($)
    await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'select-decision-0-0' })
    await Promise.all([ui.press({ key: 'send-decision-0' }), ui.press({ key: 'send-decision-0' })])
    expect(calls).toBe(1)
    expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
    // A restart cannot turn an interrupted flight back into a fresh pending card.
    await start($)
    expect(await drawn(ui)).toContain('Delivery unconfirmed')
    finish({ drop: 'Later confirmed refusal' })
    await ui.redraw()
    await ui.press({ key: 'expand-decision-0' })
    expect(await drawn(ui)).toContain('Later confirmed refusal')
    expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
    await ui.press({ key: 'send-decision-0' })
    await report($, { scope: input.scope })
    await report($, input)
    finish({ text: 'late old result', origin: { kind: 'plugin', name: 'whatsup' } })
    await ui.redraw()
    expect(await drawn(ui)).not.toContain('Sent — awaiting agent')
  })
  test('timeout locks the receipt and a late confirmed acceptance becomes Sent', async ($, on) => {
    const h = host(on); let finish!: (v: any) => void; let submitted: any
    on('prompt.submit', (_$, e) => { submitted = e; return new Promise(resolve => { finish = resolve }) })
    await start($); await report($, { scope: 'Design pending decisions in the pane', decisions: [decision] })
    const ui = await mount($)
    await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'select-decision-0-0' }); await ui.press({ key: 'send-decision-0' })
    await h.clock.advance(15000)
    expect(await drawn(ui)).toContain('Delivery unconfirmed')
    finish({ text: submitted.text, origin: submitted.origin })
    await ui.redraw()
    expect(await drawn(ui)).toContain('Sent — awaiting agent')
  })
  test('missing engine input explains unavailability without hiding the decision', async ($, on) => {
    host(on)
    on('prompt.submit', () => { throw Error('no implementation for prompt.submit') })
    await start($); await report($, { scope: 'Design pending decisions in the pane', decisions: [decision] })
    const ui = await mount($)
    await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'select-decision-0-0' }); await ui.press({ key: 'send-decision-0' })
    expect(await drawn(ui)).toContain('Answer submission unavailable')
    expect(await drawn(ui)).toContain(decision.question)
    expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
    expect(await drawn(ui)).not.toContain('Sent — awaiting agent')
  })
  for (const field of ['question', 'context', 'options', 'recommendation', 'removed'] as const) {
    test(`a queued old card press cannot send after ${field} changes`, async ($, on) => {
      host(on); let calls = 0; let release!: () => void
      on('prompt.submit', (_$, e) => { calls++; return { text: e.text, origin: e.origin } })
      on('ui.press', { element: 'send-decision-0' }, async (_$, e, next) => {
        await new Promise<void>(resolve => { release = resolve }); return next(e)
      })
      await start($); const input = { scope: 'Design pending decisions in the pane', decisions: [decision] }
      await report($, input); const ui = await mount($)
      await ui.press({ key: 'expand-decision-0' }); await ui.press({ key: 'select-decision-0-0' })
      const pressed = ui.press({ key: 'send-decision-0' })
      // Yield to the event hook before replacing its captured report.
      await ui.redraw()
      const revised = { ...decision, [field]: field === 'options' ? [...decision.options].reverse() : field === 'recommendation' ? { ...decision.recommendation, reason: decision.recommendation.reason + ' Revised.' } : String(decision[field as 'question']) + ' Revised.' }
      await report($, field === 'removed' ? { scope: input.scope } : { ...input, decisions: [revised] })
      release(); await expect(pressed).rejects.toThrow('no handler is held')
      expect(calls).toBe(0)
      expect(await ui.find({ key: 'send-decision-0' })).toBeUndefined()
    })
  }
  for (const surface of ['terminal', 'desktop'] as const) {
    test(`narrow decision states and controls fit native ${surface} rows`, async ($, on) => {
      const h = host(on); await start($)
      await report($, { scope: 'Design pending decisions', decisions: [decision] })
      for (const columns of [6, 7, 8, 9, 19, 20, 23, 24]) {
        const ui = await mount($, surface, columns)
        for (const status of ['pending', 'sending', 'sent', 'unconfirmed', 'failed'] as const) {
          h.store.set(answersKey('report-session'), { [decision.identity]: {
            version: decisionVersion(decision), selected: decision.options[0]!.identity,
            ...(status === 'pending' ? {} : { receipt: { attempt: 'width-check', option: decision.options[0], status, reason: 'Policy refused this input' }, discussion: { attempt: 'discussion-width', status, reason: 'Policy refused this input' } }),
          } })
          await ui.redraw()
          // Reopening collapses; expanded variants also cover every option/action row.
          await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
          for (const expanded of [false, true]) {
            if (expanded) await ui.press({ key: 'expand-decision-0' })
            const tree = await paneTree(ui)
            for (const row of tree.children.filter((n: Node) => /^(line|hide)-decision-/.test(String(n.props?.key)))) {
              const hotkeys = nodes(row).filter(n => n.props?.hotkey).length
              expect(cells(text(row)) + hotkeys * 3 <= columns, `${columns}, ${status}, ${row.props.key}: ${text(row)}`).toBe(true)
            }
            if (expanded && (status === 'pending' || status === 'failed')) {
              expect(await ui.find({ key: 'select-decision-0-0' })).toBeDefined()
              expect(await ui.find({ key: 'clear-decision-0' })).toBeDefined()
              expect(await ui.find({ key: 'send-decision-0' })).toBeDefined()
            }
          }
        }
        await ui.unmount()
      }
    })
  }
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
    expect(await drawn(ui)).toContain('Waiting for the agent’s first report')
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
    expect(await drawn(ui)).toContain('Waiting for the agent’s first report')
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
  test('opening the pane asks the agent for a fresh report unless input is unavailable', async ($, on) => {
    const h = host(on); const inputs: any[] = []
    on('prompt.submit', (_$, e) => { inputs.push(e); return { text: e.text, origin: e.origin } })
    await start($)
    // The submission waits for the command to return, so the clock must move before counting.
    const run = async () => { const result = await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } }); await h.clock.advance(0); return result }
    expect(JSON.stringify(await run())).toContain('asked the agent for a fresh report')
    expect(inputs).toHaveLength(1)
    expect(inputs[0].text).toBe(REFRESH_TEXT)
    expect(inputs[0].origin).toEqual({ kind: 'plugin', name: 'whatsup' })
    expect(JSON.parse(inputs[0].text).action).toContain('including answers given in chat')
    h.store.set(inputUnavailableKey('report-session'), true)
    expect(JSON.stringify(await run())).toContain('whatsup opened for this session.')
    expect(inputs).toHaveLength(1)
  })
  test('empty help fits 40 columns, section names can open links, and replacement clears UI state', async ($, on) => {
    const h = host(on); await start($)
    const ui = await mount($, 'terminal', 40)
    expect(await drawn(ui)).toContain('Waiting for the agent’s first report')
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
    for (const surface of ['terminal'] as const) for (const columns of [40, 80]) {
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
  // Boundary variants of the existing report fixture: remove optional section data.
  for (const columns of [58, 80]) for (const placement of ['dock', 'inline'] as const) {
    test(`empty section filtering and original-index actions at ${columns} columns, ${placement}`, async ($, on) => {
      host(on)
      const empty = { label: section.label, verb: section.verb, item_kind: section.item_kind }
      const named = { ...empty, name: section.name, items: [] }
      const described = { ...empty, description: section.description }
      await start($)
      for (const surface of ['terminal'] as const) {
        await report($, { scope: 'Public release', sections: [empty, named, { ...empty, name: '', description: '', items: [] }, section, empty, described] })
        const props = { title: 'whatsup', bodyColumns: columns, isFocused: true, placement, scroll: { offset: 0, bodyRows: 14 }, view: {} }
        const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status', props,
          viewport: { columns: columns + 40, rows: 46, isFullscreen: placement === 'dock' } })
        const tree = await paneTree(ui)
        const sectionKeys = () => nodes(tree).map(n => n.props?.key).filter(key => /^line-section-\d+$/.test(String(key)))
        expect(sectionKeys()).toEqual(['line-section-1', 'line-section-3', 'line-section-5'])
        for (const index of [1, 5]) {
          expect(text(await ui.find({ key: `line-section-${index}` }))).not.toContain('0/0')
          expect(await ui.find({ key: `hide-section-${index}-bar` })).toBeUndefined()
          await ui.press({ key: `expand-section-${index}` })
          expect(await ui.find({ key: `hide-section-${index}-kind` })).toBeDefined()
        }
        expect(await drawn(ui)).toContain(section.description)
        await ui.press({ key: 'expand-section-3' })
        expect(await ui.find({ key: 'show-section-3-item-0' })).toBeDefined()
        await ui.press({ key: 'show-section-3-item-0' })
        expect(await ui.find({ key: 'card-section-3-item-0' })).toBeDefined()
        await ui.press({ key: 'show-section-3-item-0' })
        // Check paging at native scroll offsets and the n/p shortcut bindings.
        expect((await ui.find({ key: 'pane-next' }) as Node).props?.hotkey).toBe('n')
        expect(await ui.find({ key: 'card-section-3-item-0' })).toBeUndefined()
        await ui.redraw({ ...props, scroll: { offset: 13, bodyRows: 14 } })
        expect((await ui.find({ key: 'pane-previous' }) as Node).props?.hotkey).toBe('p')
        expect((await ui.find({ key: 'overflow-controls' }) as Node).props?.top).toBe(26)
        const lastOffset = (await paneTree(ui)).children.filter((n: Node) => n.props?.position !== 'absolute').length - 14
        await ui.redraw({ ...props, scroll: { offset: lastOffset, bodyRows: 14 } })
        expect(await ui.find({ key: 'pane-next' })).toBeUndefined()
        expect(await ui.find({ key: 'pane-previous' })).toBeDefined()
        await ui.redraw({ ...props, scroll: { offset: 0, bodyRows: 100 } })
        expect(await ui.find({ key: 'overflow-controls' })).toBeUndefined()
        await ui.unmount()
      }
    })
    test(`only empty sections keep session and agents at ${columns} columns, ${placement}`, async ($, on) => {
      host(on); await start($)
      const empty = { label: section.label, verb: section.verb, item_kind: section.item_kind }
      await report($, { scope: 'Public release', sections: [empty, { ...empty, name: '', description: '', items: [] }],
        workers: [{ name: 'generator', role: 'main', status: 'generating', state: 'running' }] })
      for (const surface of ['terminal', 'desktop'] as const) {
        const ui = await $.ui.mount({ plugin: 'whatsup', surface, component: 'Pane', requestId: 'session-status',
          props: { title: 'whatsup', bodyColumns: columns, isFocused: false, placement, scroll: { offset: 0, bodyRows: 40 }, view: {} },
          viewport: { columns: columns + 40, rows: 46, isFullscreen: placement === 'dock' } })
        const tree = await paneTree(ui)
        expect(text(tree)).toContain('Session')
        expect(text(tree)).toContain('Public release')
        expect(text(tree)).toContain('Agents')
        expect(text(tree)).toContain('generator')
        expect(nodes(tree).some(n => /section-/.test(String(n.props?.key)))).toBe(false)
        expect(await ui.find({ key: 'overflow-controls' })).toBeUndefined()
        await ui.unmount()
      }
    })
  }

  test('overflow controls remain in the visible window at 58 columns', async ($, on) => {
    host(on); await start($)
    await report($, { scope: 'Build Session Status initial slices', sections: ['Project', 'Milestone', 'Epic', 'Queue'].map(label => ({ ...section, label })),
      workers: [
        { name: 'session', role: 'main', status: 'waiting', state: 'waiting' },
        { name: 'adapter', role: 'gen-runtime', status: 'generating', state: 'running' },
        { name: 'reviewer', role: 'eval-web', status: 'done', state: 'done' },
      ] })
    for (const surface of ['terminal'] as const) {
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
    for (const surface of ['terminal'] as const) {
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
