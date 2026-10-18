import type { CoreEngineInterface, On, Timer } from 'claude-code'
import type { ContextReport, ReportItem, ReportSection } from './report'
import { REPORT_TOOL, reportError, reportKey } from './report'

export type Enrichment = { state: 'present' | 'unavailable'; reason?: string; value?: { title?: string; status: string; labels?: string[]; blockers?: string[]; page?: string | null; total?: number; closed?: number } }
export type EnrichedItem = ReportItem & { enrichment?: Enrichment }
export type EnrichedSection = Omit<ReportSection, 'items'> & { items?: EnrichedItem[]; enrichment?: Enrichment; counts?: { done: number; active: number; total: number } }
export type EnrichedReport = Omit<ContextReport, 'sections'> & { sections?: EnrichedSection[] }
export type EnrichedSnapshot = { report: EnrichedReport; off_reason: string | null; input: string }
export const enrichmentKey = (session: string) => `github-enrichment:${session}`

const githubIdentity = (value?: string) => !!value && /^[^/\s]+\/[^/#@\s]+(?:#[1-9]\d*|@milestone\/[1-9]\d*)$/.test(value)
function unavailable(report: ContextReport): EnrichedReport {
  return { ...report, sections: report.sections?.map(section => ({ ...section,
    ...(githubIdentity(section.identity) ? { enrichment: { state: 'unavailable' as const, reason: 'reader failed' } } : {}),
    items: section.items?.map(item => ({ ...item, ...(githubIdentity(item.identity) ? { enrichment: { state: 'unavailable' as const, reason: 'reader failed' } } : {}) })),
  })) }
}

/** Reject an incomplete subprocess document before it can erase entities. */
function validateSnapshot(parsed: any, report: ContextReport) {
  if (!parsed || parsed.report?.scope !== report.scope || !(parsed.off_reason === null || typeof parsed.off_reason === 'string')) throw Error('Invalid snapshot')
  const sections = parsed.report.sections ?? []
  if (!Array.isArray(sections) || sections.length !== (report.sections ?? []).length) throw Error('Partial snapshot')
  const clean = { ...parsed.report, sections: sections.map((section: EnrichedSection, index: number) => {
    const { enrichment, counts, items, ...rest } = section
    if ((items ?? []).length !== (report.sections![index]!.items ?? []).length) throw Error('Partial items')
    if (counts && (![counts.done, counts.active, counts.total].every(n => Number.isInteger(n) && n >= 0) || counts.done + counts.active > counts.total)) throw Error('Invalid counts')
    const original = report.sections![index]!
    if (rest.identity !== original.identity) throw Error('Changed identity')
    if (githubIdentity(original.identity) && !enrichment && !parsed.off_reason) throw Error('Missing enrichment')
    const cleanItems = items?.map((item, itemIndex) => {
      const { enrichment: facts, ...value } = item
      if (value.identity !== original.items![itemIndex]!.identity) throw Error('Changed item identity')
      if (githubIdentity(value.identity) && !facts && !parsed.off_reason) throw Error('Missing item enrichment')
      if (facts && !['present','unavailable'].includes(facts.state)) throw Error('Invalid entity')
      if (facts?.state === 'present' && !facts.value) throw Error('Missing facts')
      return value
    })
    return { ...rest, ...(cleanItems ? { items: cleanItems } : {}) }
  }) }
  if (reportError(clean)) throw Error('Invalid report')
}

async function refresh($: CoreEngineInterface, session: string, versions: Map<string, number>, issue_kinds: string[]) {
    const report = await $.store.get(reportKey(session)) as ContextReport | undefined
    if (!report) return
    const version = (versions.get(session) ?? 0) + 1
    versions.set(session, version)
    const input = JSON.stringify(report)
    let snapshot: EnrichedSnapshot = { report: unavailable(report), off_reason: null, input }
    try {
      const result = await $.process.run(['python3', `${$.plugin.root}/reader/main.py`], {
        stdin: JSON.stringify({ report, issue_kinds }), timeoutMs: 55000,
      })
      if (result.exitCode === 0 && !('isStdoutTruncated' in result && result.isStdoutTruncated)) {
        const parsed = JSON.parse(result.stdout)
        validateSnapshot(parsed, report)
        snapshot = { ...parsed, input }
      }
    } catch { /* Do not display stderr or exception text: they may contain credentials. */ }
    if (versions.get(session) !== version || JSON.stringify(await $.store.get(reportKey(session))) !== input) return
    await $.store.set(enrichmentKey(session), snapshot)
    $.ui.invalidate('ui.render')
  }

/** Each open pane owns one timer; closing it stops reads and cancels the timer. */
export function registerEnrichment(on: On, recorded: boolean, issueKinds = 'tickets,issues,epics') {
  const shown = new Map<string, Timer>()
  const versions = new Map<string, number>()
  const issue_kinds = issueKinds.split(',').map(kind => kind.trim()).filter(Boolean)
  if (!recorded) {
    on('tool.call', { tool: REPORT_TOOL }, async ($, e, next) => {
      const result = await next(e)
      const session = await $.session.id()
      if (shown.has(session)) await refresh($, session, versions, issue_kinds)
      return result
    })
    on('ui.open', async ($, e, next) => {
      if (e.id !== 'session-status') return next(e)
      const session = await $.session.id()
      shown.get(session)?.cancel()
      const timer = $.clock.every(60000, () => { void refresh($, session, versions, issue_kinds) })
      shown.set(session, timer)
      await refresh($, session, versions, issue_kinds)
      return next(e)
    })
    on('ui.close', async ($, e, next) => {
      if (e.id === 'session-status') {
        const session = await $.session.id()
        shown.get(session)?.cancel(); shown.delete(session)
        versions.set(session, (versions.get(session) ?? 0) + 1)
      }
      return next(e)
    })
  }
}
