import { CHOSEN, workerStyle } from './chosen-style'
import type { CoreEngineInterface, On, Timer } from 'claude-code'
import type { Worker, ContextReport } from './report'
import { reportKey } from './report'
import { factsKey } from './session-facts'
import type { SessionFacts } from './session-facts'
import { cells, fit } from './session-facts'
import type { ReportLine } from './report-layout'
import type { Part } from './layout'

export type LiveWorker = Omit<Worker, 'tokens' | 'context'> & { id?: string; started: number; changed: number; minutes: Record<number, number>; context?: { tokens: number; window?: number }; inFlight?: boolean }
type WorkerStore = { observed: LiveWorker[]; merged: LiveWorker[] }
export const workersKey = (session: string) => `workers:${session}`
const terminal = (w: Pick<Worker, 'state'>) => w.state === 'done' || w.state === 'failed'
const timestamp = (value: string | undefined, fallback: number) => value && Number.isFinite(Date.parse(value)) ? Date.parse(value) : fallback

/** Observation owns measurements and identity; reports can fill a missing context window. */
export function mergeWorkers(observed: LiveWorker[], reported: Worker[], previous: LiveWorker[], now: number, retainExpired = false): LiveWorker[] {
  const result = observed.map(w => ({ ...w }))
  for (const report of reported) {
    const index = result.findIndex(w => w.name === report.name || (w.id === 'main' && report.role === 'main'))
    if (index >= 0) {
      const w = result[index]!
      const context = w.context ? { ...w.context, window: w.context.window ?? report.context?.window } : undefined
      result[index] = { ...w, context, ...(w.id === 'main' ? { name: report.name, role: report.role } : {}), status: report.status, state: report.state, task: report.task ?? w.task, source: 'both', changed: w.state === report.state ? w.changed : now }
    } else {
      const prior = previous.find(w => w.name === report.name)
      const started = timestamp(report.first_seen, prior?.started ?? now)
      result.push({ ...report, started, changed: timestamp(report.last_state_change, now), total: report.total ?? (report.tokens ? report.tokens.reduce((a, b) => a + b, 0) : undefined), minutes: Object.fromEntries((report.tokens ?? []).map((tokens, i) => [Math.floor(started / 60000) + i, tokens])), source: 'reported' })
    }
  }
  return result.map(w => {
    const prior = previous.find(p => (w.id && p.id === w.id) || p.name === w.name)
    return { ...w, changed: prior?.state === w.state ? prior.changed : w.changed }
  }).filter((w, index) => retainExpired || index === 0 && w.id === 'main' || !terminal(w) || now - w.changed < 600000)
}

/** One cell per minute; eight height steps relative to the busiest visible minute. */
export function tokenGraph(worker: LiveWorker, width: number, now: number, reduced: boolean): string {
  const keys = Object.keys(worker.minutes).map(Number)
  if (!keys.length || width <= 0) return ''
  const end = Math.floor((terminal(worker) || worker.state === 'waiting' ? worker.changed : reduced ? Math.max(...keys) * 60000 : now) / 60000)
  const start = Math.max(Math.min(...keys), end - width + 1)
  const peak = Math.max(0, ...keys.filter(minute => minute >= start && minute <= end).map(minute => worker.minutes[minute]!))
  let graph = ''
  for (let minute = start; minute <= end; minute++) {
    let level = peak > 0 ? Math.ceil(8 * (worker.minutes[minute] ?? 0) / peak) : 0
    if (!reduced && worker.inFlight && worker.state === 'running' && minute === end) level = Math.max(0, level - 1)
    graph += ' ▁▂▃▄▅▆▇█'[level]
  }
  return graph
}
const compact = (n: number) => n >= 1000 ? `${Math.round(n / 100) / 10}k` : String(n)
const emoji: Record<string, string> = { generating: '🐝', reviewing: '🧐', evaluating: '🔬', testing: '🧪', waiting: '🪑', done: '✅', failed: '❌' }
export function workerLines(workers: LiveWorker[], columns: number, now: number, reduced: boolean, statusEmoji: Record<string, string> = emoji): ReportLine[] {
  if (!workers.length || columns < 12) return []
  const lines: ReportLine[] = [{ key: 'agents', parts: [{ text: '   🤖 Agents', color: CHOSEN.agents, bold: true }, { text: fit(` · ${workers.filter(w => w.state === 'running').length} running`, Math.max(0, columns - 12)), dim: true, color: CHOSEN.muted }] }]
  const width = columns - 4
  for (const [index, worker] of workers.entries()) {
    // Failure freezes activity, but only completed work loses its role emphasis.
    const key = `worker-${index}`, dim = worker.state === 'done'
    const role = workerStyle(worker.role, worker.id === 'main')
    const accent = dim ? CHOSEN.grey : role.accent
    const style = (parts: Part[]) => parts.map(p => ({ color: accent, ...p, dim }))
    const badge = fit(columns < 56 ? (worker.model ?? '—').replace(/^claude-/, '') : worker.model ?? '—', Math.max(1, width - 6))
    const title = fit(`▾ ${worker.role} · ${worker.name}`, Math.max(1, columns - cells(badge) - 11))
    const suffix = ' ' + '─'.repeat(Math.max(0, columns - cells(title) - cells(badge) - 10)) + ` [${badge}] ─┐`
    lines.push({ key, prefix: '┌─ ', parts: style([{ text: title, bold: true }]), suffix, badge, dim, accent })
    const boxed = (id: string, parts: Part[], item?: ReportLine['item']) => lines.push({ key: `${key}-${id}`, prefix: '│ ', parts: style(parts), background: dim ? undefined : role.tint, suffix: ' '.repeat(Math.max(0, width - parts.reduce((n, p) => n + cells(p.text), 0))) + ' │', item, dim, accent })
    boxed('top-space', [])
    const minutes = Math.max(0, Math.floor(((terminal(worker) ? worker.changed : now) - worker.started) / 60000))
    const elapsed = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
    const task = worker.task, taskWidth = Math.max(0, width - cells(elapsed) - 1)
    const parts: Part[] = []
    if (typeof task === 'object' && task.number !== undefined) parts.push({ text: fit(`#${task.number}`, taskWidth), underline: !!task.link })
    const used = parts.reduce((n, p) => n + cells(p.text), 0)
    parts.push({ color: CHOSEN.text, text: fit((used ? ' ' : '') + (typeof task === 'string' ? task : task?.title ?? ''), Math.max(0, taskWidth - used)) })
    parts.push({ color: CHOSEN.text, bold: true, text: ' '.repeat(Math.max(1, width - parts.reduce((n, p) => n + cells(p.text), 0) - cells(elapsed))) + elapsed })
    boxed('task', parts, typeof task === 'object' ? { key: `${key}-task`, page: task.link ?? null, details: [task.title, ...(task.number ? [`Number: ${task.number}`] : [])] } : undefined)
    const percent = worker.context?.window ? Math.round(100 * worker.context.tokens / worker.context.window) : undefined
    const filled = percent === undefined ? 0 : Math.min(6, Math.max(0, Math.round(percent * 6 / 100)))
    const gauge = percent === undefined ? '—' : '▰'.repeat(filled) + '▱'.repeat(6 - filled) + ` ${percent}%`
    const total = worker.total === undefined ? '' : `${compact(worker.total)} tokens`
    const side = Math.min(width, Math.max(12, cells(total), cells(gauge)))
    const left = Math.max(0, width - side - 1)
    const graph = tokenGraph(worker, left, now, reduced)
    boxed('graph', [{ text: graph + ' '.repeat(Math.max(0, width - cells(graph) - cells(total))) + total }])
    boxed('status-space', [])
    const status = fit(`${statusEmoji[worker.status] ?? '◐'} ${worker.status}`, left)
    boxed('status', [{ bold: true, text: status + ' '.repeat(Math.max(0, width - cells(status) - cells(gauge))) }, { text: gauge, color: percent !== undefined && percent > 80 ? CHOSEN.warning : accent }])
    lines.push({ key: `${key}-bottom`, parts: style([{ text: '└' + '─'.repeat(columns - 2) + '┘' }]), dim, accent })
  }
  return lines
}

// Serialize store updates per session so concurrent subagent requests cannot lose usage.
const pending = new Map<string, Promise<unknown>>()
async function mutate($: CoreEngineInterface, change: (data: WorkerStore, now: number) => void, invalidate = true) {
  const session = await $.session.id()
  const previous = pending.get(session) ?? Promise.resolve()
  const task = previous.catch(() => {}).then(async () => {
    const data = await $.store.get(workersKey(session)) as WorkerStore | undefined ?? { observed: [], merged: [] }
    change(data, await $.clock.now())
    await $.store.set(workersKey(session), data)
    if (invalidate) $.ui.invalidate('ui.render')
  })
  pending.set(session, task)
  try { await task } finally { if (pending.get(session) === task) pending.delete(session) }
}
export async function paneWorkers($: CoreEngineInterface, now: number): Promise<LiveWorker[]> {
  const session = await $.session.id()
  let agents: Awaited<ReturnType<typeof $.agent.list>> = []
  try { agents = await $.agent.list() } catch { /* Spawn hooks still supply workers. */ }
  let model: string | undefined, usage: Awaited<ReturnType<typeof $.session.usage>> | undefined
  try { model = await $.session.model() } catch {}
  try { usage = await $.session.usage() } catch {}
  const facts = await $.store.get(factsKey(session)) as SessionFacts | undefined
  const report = await $.store.get(reportKey(session)) as ContextReport | undefined
  await mutate($, (data, time) => {
    if (!data.observed.some(w => w.id === 'main')) data.observed.unshift({ id: 'main', name: 'session', role: 'main', status: 'waiting', state: 'waiting', started: facts?.started ?? time, changed: time, minutes: {}, source: 'observed' })
    const main = data.observed.find(w => w.id === 'main')!
    main.model = model ?? main.model
    if (usage?.context.tokens !== undefined) main.context = { tokens: usage.context.tokens, window: usage.context.window }
    for (const agent of agents) {
      let w = data.observed.find(w => w.id === agent.id)
      if (!w) { w = { id: agent.id, name: agent.name ?? agent.id, role: agent.type, task: agent.description, status: 'generating', state: 'running', started: time, changed: time, minutes: {}, source: 'observed' }; data.observed.push(w) }
      const state = agent.status === 'completed' ? 'done' : ['failed', 'killed'].includes(agent.status) ? 'failed' : agent.status === 'running' ? 'running' : 'waiting'
      if (w.state !== state) { w.state = state; w.changed = time; w.status = state === 'running' ? 'generating' : state }
    }
    // A measured model window is reusable only for the same resolved model id.
    for (const w of data.observed) if (w.context && w.model === model && usage?.context.window) w.context.window = usage.context.window
    data.merged = mergeWorkers(data.observed, report?.workers ?? [], data.merged, now, true)
  }, false)
  const data = await $.store.get(workersKey(session)) as WorkerStore
  return data.merged.filter(w => w.id === 'main' || !terminal(w) || now - w.changed < 600000)
}
export async function reducedMotion($: CoreEngineInterface): Promise<boolean> {
  try { const settings = await $.settings.read(); return settings.prefersReducedMotion === true } catch { return false }
}
export function registerWorkers(on: On, recorded: boolean) {
  if (recorded) return
  const timers = new Map<string, Timer>()
  on('agent.spawn', async ($, e, next) => {
    const started = await $.clock.now()
    const result = await next(e)
    if (result.agentId) await mutate($, data => {
      const existing = data.observed.find(w => w.id === result.agentId)
      const worker: LiveWorker = { ...existing, id: result.agentId, name: e.name ?? result.agentId!, role: e.subagentType, task: e.description, model: result.model, status: 'generating', state: 'running', started, changed: started, minutes: existing?.minutes ?? {}, source: 'observed' }
      if (existing) Object.assign(existing, worker); else data.observed.push(worker)
    })
    return result
  })
  on('turn.step', async function* ($, e, next) {
    const id = e.agentId ?? 'main'
    await mutate($, (data, now) => {
      let w = data.observed.find(w => w.id === id)
      if (!w) { w = { id, name: id === 'main' ? 'session' : id, role: id === 'main' ? 'main' : 'agent', status: 'generating', state: 'running', started: now, changed: now, minutes: {}, source: 'observed' }; id === 'main' ? data.observed.unshift(w) : data.observed.push(w) }
      w.inFlight = true; w.model = e.model
      if (w.state !== 'running') w.changed = now
      w.state = 'running'; w.status = 'generating'
    })
    try {
      const result = yield* next(e)
      if (result.usage) await mutate($, (data, now) => {
        const w = data.observed.find(w => w.id === id)!, u = result.usage!
        const input = u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
        const tokens = input + u.output_tokens, minute = Math.floor(now / 60000)
        w.minutes[minute] = (w.minutes[minute] ?? 0) + tokens; w.total = (w.total ?? 0) + tokens
        w.model = u.model; w.context = { tokens: input, window: w.context?.window }
      })
      return result
    } finally { await mutate($, data => { data.observed.find(w => w.id === id)!.inFlight = false }) }
  })
  on('turn.complete', async ($, e, next) => {
    await mutate($, (data, now) => {
      const w = data.observed.find(w => w.id === (e.agentId ?? 'main'))
      if (w) { w.state = e.agentId ? e.reason === 'error' || e.reason === 'refusal' ? 'failed' : 'done' : 'waiting'; w.status = w.state; w.changed = now; w.inFlight = false }
    })
    return next(e)
  })
  on('ui.open', { id: 'session-status' }, async ($, e, next) => {
    const session = await $.session.id()
    timers.get(session)?.cancel()
    if (!await reducedMotion($)) timers.set(session, $.clock.every(60000, () => { $.ui.invalidate('ui.render') }))
    return next(e)
  })
  on('ui.close', { id: 'session-status' }, async ($, e, next) => { const session = await $.session.id(); timers.get(session)?.cancel(); timers.delete(session); return next(e) })
  on('session.end', async ($, e, next) => { timers.get(e.sessionId)?.cancel(); timers.delete(e.sessionId); return next(e) })
}
