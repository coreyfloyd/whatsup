import type { CoreEngineInterface } from 'claude-code'
import { decisionVersion, reportKey } from './report'
import type { ContextReport, Decision, DecisionOption } from './report'

type Attempt = { attempt: string; status: 'sending' | 'sent' | 'failed' | 'unconfirmed'; reason?: string }
export type AnswerState = { discussion?: Attempt; version: string; selected?: string; receipt?: { attempt: string; option: DecisionOption; status: 'sending' | 'sent' | 'failed' | 'unconfirmed'; reason?: string } }
export type AnswerStates = Record<string, AnswerState>
export const answersKey = (session: string) => `decision-answers:${session}`
// Serialize local read/modify/write operations, never the transport wait. Reports
// and presses share this lane so removal/revision invalidates captured callbacks.
const lanes = new Map<string, Promise<unknown>>()
export function decisionLane<T>(session: string, task: () => Promise<T>): Promise<T> {
  const result = (lanes.get(session) ?? Promise.resolve()).then(task, task)
  lanes.set(session, result)
  void result.finally(() => { if (lanes.get(session) === result) lanes.delete(session) }).catch(() => {})
  return result
}
export async function answerStates($: CoreEngineInterface, session: string): Promise<AnswerStates> {
  return await $.store.get(answersKey(session)) as AnswerStates ?? {}
}
export async function reconcileAnswers($: CoreEngineInterface, session: string, report: ContextReport | null, resume = false) {
  const old = await answerStates($, session)
  const states: AnswerStates = {}
  for (const decision of report?.decisions ?? []) {
    const version = decisionVersion(decision)
    const previous = Object.hasOwn(old, decision.identity) ? old[decision.identity] : undefined
    if (previous?.version !== version) continue
    const receipt = previous.receipt
    const discussion = previous.discussion
    states[decision.identity] = { ...previous, ...(resume && discussion?.status === 'sending' ? { discussion: { ...discussion, status: 'unconfirmed' as const } } : {}), ...(resume && receipt?.status === 'sending' ? { receipt: { ...receipt, status: 'unconfirmed' as const } } : {}) }
  }
  await $.store.set(answersKey(session), states)
}
export const inputUnavailableKey = (session: string) => `decision-input-unavailable:${session}`
export function answerText(decision: Decision, option: DecisionOption): string {
  return JSON.stringify({ action: 'Answer selected in the whatsup pane. Apply the receiving session’s normal authorization rules.', decision: { identity: decision.identity, question: decision.question }, answer: option })
}
export const REFRESH_TEXT = JSON.stringify({ action: 'The whatsup pane was opened. Send one complete mcp__whatsup__report with the current scope, sections, workers and outstanding decisions; remove decisions already resolved, including answers given in chat. This is display state only, not a new task or an authorization.' })
export async function selectAnswer($: CoreEngineInterface, session: string, identity: string, version: string, option?: string) {
  await decisionLane(session, async () => {
    if (await $.session.id() !== session) return
    const report = await $.store.get(reportKey(session)) as ContextReport | undefined
    const decision = report?.decisions?.find(d => d.identity === identity && decisionVersion(d) === version)
    if (!decision || (option && !decision.options.some(o => o.identity === option))) return
    const states = await answerStates($, session)
    const state = Object.hasOwn(states, identity) ? states[identity] : undefined
    if (state?.version === version && state.receipt && state.receipt.status !== 'failed') return
    await $.store.set(answersKey(session), { ...states, [identity]: { ...state, version, selected: option } })
    $.ui.invalidate('ui.render')
  })
}
export function discussionText(decision: Decision): string {
  return JSON.stringify({ action: 'Discussion request from the whatsup pane, not an answer, approval or resolution. Discuss this question in the main conversation: provide any missing explanation and invite challenges to the options or an alternative, including a custom answer in chat. Keep this decision pending; update missing context when appropriate. Apply the receiving session’s normal authorization rules.', decision: { identity: decision.identity, question: decision.question } })
}
export async function discussDecision($: CoreEngineInterface, session: string, identity: string, version: string) {
  return submitDecision($, session, identity, version, 'discussion')
}
let attemptNumber = 0
export async function sendAnswer($: CoreEngineInterface, session: string, identity: string, version: string, displayedOption: string) {
  return submitDecision($, session, identity, version, 'receipt', displayedOption)
}
async function submitDecision($: CoreEngineInterface, session: string, identity: string, version: string, kind: 'receipt' | 'discussion', displayedOption?: string) {
  await decisionLane(session, async () => {
    if (await $.session.id() !== session || await $.store.get(inputUnavailableKey(session))) return
    const report = await $.store.get(reportKey(session)) as ContextReport | undefined
    const decision = report?.decisions?.find(d => d.identity === identity && decisionVersion(d) === version)
    const states = await answerStates($, session)
    const state = (Object.hasOwn(states, identity) ? states[identity] : undefined) ?? { version }
    if (!decision || state.version !== version || (state.receipt && state.receipt.status !== 'failed') || (kind === 'discussion' && state.discussion && state.discussion.status !== 'failed' && state.discussion.status !== 'sent') || (kind === 'receipt' && state.selected !== displayedOption)) return
    const option = decision.options.find(o => o.identity === state.selected)
    if (kind === 'receipt' && !option) return
    const attempt = `${await $.clock.now()}:${++attemptNumber}`
    const receipt = { attempt, ...(kind === 'receipt' ? { option: option! } : {}), status: 'sending' as const }
    await $.store.set(answersKey(session), { ...states, [identity]: { ...state, [kind]: receipt } })
    $.ui.invalidate('ui.render')
    const finish = (status: 'sent' | 'failed' | 'unconfirmed', reason?: string) => decisionLane(session, async () => {
      const latest = await answerStates($, session)
      const current = Object.hasOwn(latest, identity) ? latest[identity] : undefined
      if (current?.version !== version || current[kind]?.attempt !== attempt || current[kind].status === 'sent' || current[kind].status === 'failed') return
      await $.store.set(answersKey(session), { ...latest, [identity]: { ...current, [kind]: { ...receipt, status, reason } } })
      $.ui.invalidate('ui.render')
    })
    const timeout = $.clock.after(15000, () => { void finish('unconfirmed', 'No acceptance confirmation received.') })
    const text = kind === 'receipt' ? answerText(decision, option!) : discussionText(decision)
    // Do not await the engine in the press handler: the pane stays responsive
    // during a busy main turn; the durable attempt already blocks duplicates.
    void $.prompt.submit({ text }).then(async result => {
      timeout.cancel()
      if (result && typeof result.drop === 'string') await finish('failed', result.drop)
      else if (result && result.text === text && result.origin?.kind === 'plugin' && result.origin.name === 'whatsup') await finish('sent')
      else await finish('unconfirmed', 'The engine did not confirm the submitted text and plugin provenance.')
    }, async error => {
      timeout.cancel()
      const reason = String(error)
      if (/no implementation for prompt\.submit|prompt\.submit.*(?:unsupported|not supported)/i.test(reason)) {
        await $.store.set(inputUnavailableKey(session), true)
        await finish('failed', 'Input submission unavailable in this engine. Continue in the main conversation.')
      } else await finish('unconfirmed', 'The submission ended without confirmation.')
    })
  })
}
