import type { AnswerStates } from './decision-input'
import { decisionVersion } from './report'
import { clip, wrap } from './layout'
import { CHOSEN, SECTION_STYLES, gradient } from './chosen-style'
import { TEMPLATES } from './templates'
import type { Template } from './templates'
import { cells } from './session-facts'
import type { Item, Part } from './layout'
import type { EnrichedReport, EnrichedSection } from './enrichment'

export type ReportLine = { key: string; parts: Part[]; item?: Item; marker?: string; expand?: number; decision?: { identity: string; version: string; hotkey?: string }; action?: { identity: string; version: string; kind: 'select' | 'clear' | 'send' | 'discuss'; option?: string; hotkey?: string }; prefix?: string; suffix?: string; badge?: string; unavailable?: boolean; dim?: boolean; accent?: string; background?: string }
export const EMPTY_REPORT = 'mcp__whatsup__report({"scope":"work"})'
const glyph = { done: '✓', active: '◐', queued: '○' }

/** Derive counts only from the section’s ordered items. No section labels are special. */
export function sectionCounts(section: EnrichedSection) {
  const items = section.items ?? []
  if (section.counts) return { ...section.counts, percent: section.counts.total ? Math.round(100 * section.counts.done / section.counts.total) : 0 }
  const done = items.filter(item => item.state === 'done').length
  const active = items.filter(item => item.state === 'active').length
  return { done, active, total: items.length, percent: items.length ? Math.round(100 * done / items.length) : 0 }
}
export function reportLines(report: EnrichedReport | null, columns: number, expanded: number[] = [], offReason?: string | null, config: Template = TEMPLATES.github!, expandedDecision?: string | null, answers: AnswerStates = {}, inputAvailable = true): ReportLine[] {
  const lines: ReportLine[] = []
  const text = (key: string, value: string, dim = false) => lines.push({ key, parts: [{ text: clip(value, columns), dim }] })
  if (!report) { text('empty', EMPTY_REPORT, true); return lines }
  text('scope', report.scope)
  if (offReason) text('enrichment-off', offReason, true)
  for (const [index, decision] of (report.decisions ?? []).entries()) {
    const key = `decision-${index}`
    const version = decisionVersion(decision)
    const state = Object.hasOwn(answers, decision.identity) && answers[decision.identity]?.version === version ? answers[decision.identity] : undefined
    const receipt = state?.receipt
    const locked = receipt && receipt.status !== 'failed'
    const open = expandedDecision === version && !locked
    const accent = '#ff7b86'
    const inner = Math.max(1, columns - 4)
    const heading = `${open ? '▾' : '▸'} Decision ${index + 1}`
    const status = receipt?.status === 'sent' ? 'SENT' : receipt?.status === 'unconfirmed' ? 'UNCONFIRMED' : receipt?.status === 'sending' ? 'SENDING' : 'ANSWER NEEDED'
    const compact = columns < 24
    const hotkey = !compact && index === 0 ? 'd' : undefined
    const shortcutCells = hotkey ? 3 : 0
    const compactStatus = receipt?.status === 'sent' ? 'Sent' : receipt?.status === 'unconfirmed' ? 'Unsure' : receipt?.status === 'sending' ? 'Wait' : receipt?.status === 'failed' ? 'Retry' : 'Answer'
    // Narrow headers keep a complete textual status instead of forcing the
    // title, frame and long status into a width smaller than their fixed cost.
    const title = compact ? compactStatus : clip(heading, Math.max(1, columns - cells(status) - 7 - shortcutCells))
    lines.push({ key, prefix: compact ? '' : '┌─ ', parts: [{ text: title, bold: true, color: accent }], suffix: compact ? '' : ' ' + '─'.repeat(Math.max(0, columns - cells(title) - cells(status) - 7 - shortcutCells)) + ` ${status} ┐`, accent, decision: { identity: decision.identity, version, hotkey } })
    const row = (name: string, value = '', color?: string, bold = false) => wrap(value, inner).forEach((text, i) => lines.push({
      key: `${key}-${name}-${i}`, prefix: '│ ', parts: [{ text, color, bold }], suffix: ' '.repeat(Math.max(0, inner - cells(text))) + ' │', accent,
    }))
    row('space')
    row('question', decision.question, undefined, true)
    if (locked) {
      row('answer', `Answer: ${receipt.option.label}`)
      row('receipt', receipt.status === 'sent' ? 'Sent — awaiting agent' : receipt.status === 'sending' ? 'Sending answer…' : 'Delivery unconfirmed')
      if (receipt.status === 'unconfirmed') row('recovery', 'Check the main conversation and continue there manually. Do not send this answer again from the pane.')
    }
    const discussion = state?.discussion
    if (discussion) {
      row('discussion-status', discussion.status === 'sent' ? 'Discussion requested — answer still needed' : discussion.status === 'sending' ? 'Requesting discussion…' : discussion.status === 'failed' ? `Discussion not sent: ${discussion.reason}` : 'Discussion unconfirmed')
      if (discussion.status === 'unconfirmed') row('discussion-recovery', 'Check the main conversation and continue manually there. Do not repeat this discussion request from the pane. You can still select and send an answer.')
    }
    if (open) {
      const action = (name: string, label: string, kind: 'select' | 'clear' | 'send' | 'discuss', option?: string, hotkey?: string) => {
        // Native hotkey prefixes consume three cells in addition to the label.
        if (columns < 24) hotkey = undefined
        const wrapped = wrap(label, Math.max(1, inner - (hotkey ? 3 : 0)))
        wrapped.forEach((text, i) => lines.push({ key: `${key}-${name}-${i}`, prefix: '│ ', parts: [{ text }], suffix: ' '.repeat(Math.max(0, inner - cells(text) - (i === 0 && hotkey ? 3 : 0))) + ' │', accent,
          action: { identity: decision.identity, version, kind, option, hotkey: i === 0 ? hotkey : undefined } }))
      }

      row('why-space'); row('why-label', 'WHY THIS MATTERS', accent); row('why', decision.why_now)
      row('context-space'); row('context-label', 'CONTEXT', accent); row('context', decision.context)
      const recommended = decision.options.find(option => option.identity === decision.recommendation.option)!
      row('recommendation-space'); row('recommendation-label', 'RECOMMENDATION', accent)
      row('recommended', `Recommended: ${recommended.label}`, accent)
      row('reason', decision.recommendation.reason)
      for (const [optionIndex, option] of decision.options.entries()) {
        row(`option-${optionIndex}-space`)
        action(`option-${optionIndex}-label`, `${state?.selected === option.identity ? '●' : '○'} ${option.label}`, 'select', option.identity, expandedDecision === version && optionIndex < 9 ? String(optionIndex + 1) : undefined)
        row(`option-${optionIndex}-benefit`, `Benefit: ${option.benefit}`)
        row(`option-${optionIndex}-cost`, `Cost: ${option.cost}`)
      }
      row('end-space')
      if (receipt?.status === 'failed') row('failure', `Not sent: ${receipt.reason}`)
      if (!inputAvailable) row('unavailable', 'Answer submission unavailable in this engine. Answer in the main conversation.')
      else if (state?.selected) {
        action('clear', 'Clear selection', 'clear', undefined, 'c')
        action('send', 'Send answer', 'send', state.selected, 's')
      } else row('select-first', 'Select an option to enable Send answer.')
      if (inputAvailable && (!discussion || discussion.status === 'failed' || discussion.status === 'sent')) action('discuss', 'Talk about this in chat', 'discuss', undefined, 't')
    }
    lines.push({ key: `${key}-bottom`, parts: [{ text: '└' + '─'.repeat(Math.max(0, columns - 2)) + '┘', color: accent }], accent })
  }
  for (const [index, section] of (report.sections ?? []).entries()) {
    if (!section.name && !section.description && !section.items?.length) continue
    const key = `section-${index}`
    const definitionKey = Object.keys(config.sections).find(key => config.sections[key]!.label === section.label)
    const definition = definitionKey ? config.sections[definitionKey] : undefined
    const role = ['project', 'milestone', 'epic', 'queue'].indexOf(definitionKey ?? section.label.toLowerCase())
    const style = SECTION_STYLES[role < 0 ? 3 : role]!
    const inner = Math.max(1, columns - 4)
    const failure = section.enrichment?.state === 'unavailable' ? section.enrichment.reason : (section.items ?? []).find(item => item.enrichment?.state === 'unavailable')?.enrichment?.reason
    const failed = failure !== undefined
    const { done, active, total, percent } = sectionCounts(section)
    const badge = failed ? "⚠️ Couldn't load" : total ? clip(`${done}/${total}` + (columns >= 56 ? ` ${section.verb}` : ''), Math.max(1, columns - 16)) : ''
    const marker = expanded.includes(index) ? '▾ ' : '▸ '
    const party = total > 0 && done === total && !failed ? ' 🎉' : ''
    const name = clip((!failed && definition?.emoji ? `${definition.emoji} ` : '') + section.label + (section.name && columns >= 56 ? ` · ${section.name}` : ''), Math.max(1, columns - cells(marker) - cells(badge) - cells(party) - 11))
    const tail = (badge ? ` [${badge}]${party}` : '') + ' ─┐'
    const rule = '─'.repeat(Math.max(0, columns - 3 - cells(marker) - cells(name) - cells(tail)))
    lines.push({ key, prefix: '┌─ ', marker, expand: index, parts: [{ text: name, bold: true, color: style.accent, ...(failed ? { dim: true, color: '#808080' } : {}) }], suffix: ' ' + rule.slice(1) + tail,
      badge, accent: style.accent, item: { key, page: section.link ?? null, details: [section.label + (section.name ? `: ${section.name}` : ''), ...(section.description ? [section.description] : []), ...(failed ? [`Couldn't load: ${failure}`] : total ? [`${done}/${total} ${section.verb}`] : [])] } })
    const boxed = (row: string, parts: Part[], item?: Item) => {
      const length = parts.reduce((n, part) => n + cells(part.text), 0)
      lines.push({ key: row, prefix: '│ ', parts, suffix: ' '.repeat(Math.max(0, inner - length)) + ' │', item })
    }
    boxed(`${key}-top-space`, [])
    if (failed) boxed(`${key}-track`, [{ text: '┄'.repeat(inner), dim: true }])
    if (failed) boxed(`${key}-failure`, [{ text: clip(`⚠️ Couldn't load: ${failure}`, inner), dim: true, color: '#808080' }])
    if (total && !failed) {
      const width = Math.max(1, inner - 5)
      const filled = done === total ? width : Math.min(width - 1, Math.max(done ? 1 : 0, Math.round(done / total * width)))
      const working = Math.min(width - filled, Math.max(active ? 1 : 0, Math.round((done + active) / total * width) - filled))
      const stops = done === total ? ['#5fbf74', '#c4f2b8'] : style.gradient
      boxed(`${key}-bar`, [...Array.from({ length: filled }, (_, i) => ({ text: '█', color: gradient(stops[0]!, stops[1]!, i, filled) })), { text: '░'.repeat(working), color: style.accent }, { text: '·'.repeat(width - filled - working), color: CHOSEN.faint }, { text: `${percent}%`.padStart(5), color: style.accent, bold: true }])
    }
    if (expanded.includes(index)) {
      if (section.description) wrap(section.description, inner).forEach((row, i) => boxed(i ? `${key}-description-${i}` : `${key}-description`, [{ text: row }]))
      boxed(`${key}-kind`, [{ text: clip('  ' + section.item_kind, inner), dim: true }])
      for (const [itemIndex, item] of (section.items ?? []).entries()) {
        const itemKey = `${key}-item-${itemIndex}`
        const itemFailed = item.enrichment?.state === 'unavailable'
        const parts: Part[] = [{ text: itemFailed ? '  ⚠️ ' : `  ${glyph[item.state]} ` }]
        let remaining = inner - cells(parts[0]!.text)
        if (item.number !== undefined) {
          const number = clip(`#${item.number}`, remaining)
          parts.push({ text: number, underline: !!item.link })
          remaining -= cells(number)
          if (remaining > 0) { parts.push({ text: ' ' }); remaining-- }
        }
        if (!itemFailed) { parts[0]!.color = item.state === 'done' ? CHOSEN.success : item.state === 'active' ? '#ff9ecb' : CHOSEN.muted; if (item.state !== 'active') parts.forEach(p => { p.dim = true }) }
        parts.push({ dim: item.state !== 'active', text: clip(itemFailed ? `Couldn't load: ${item.enrichment?.reason}` : item.title, Math.max(0, remaining)) })
        if (itemFailed) parts.forEach(part => { part.dim = true; part.color = '#808080' })
        const facts = item.enrichment?.state === 'present' ? item.enrichment.value : undefined
        const details = facts ? [`Status: ${facts.status}`, ...(facts.labels ? [`Labels: ${facts.labels.join(', ') || 'none'}`] : []), ...(facts.blockers ? [`Blockers: ${facts.blockers.join(', ') || 'none'}`] : []), ...(facts.total !== undefined ? [`Members: ${facts.total}`, `Closed: ${facts.closed}`] : [])] : itemFailed ? [`Couldn't load: ${item.enrichment?.reason}`] : []
        boxed(itemKey, parts, { key: itemKey, page: item.link ?? null, details: [item.title, ...details, `State: ${item.state}`, ...(item.number !== undefined ? [`Number: ${item.number}`] : []), ...(item.identity ? [`Identity: ${item.identity}`] : [])] })
      }
    }
    text(`${key}-bottom`, '└' + '─'.repeat(Math.max(0, columns - 2)) + '┘')
    for (const line of lines.filter(line => line.key === key || line.key.startsWith(`${key}-`))) {
      line.accent = failed ? CHOSEN.grey : style.accent
      if (!failed && line.prefix === '│ ') line.background = style.tint
      line.parts.forEach(part => { part.color ??= line.key.endsWith('-bottom') ? style.accent : CHOSEN.text })
    }
    if (failed) for (const line of lines.filter(line => line.key === key || line.key.startsWith(`${key}-`))) {
      line.unavailable = true
      line.parts.forEach(part => { part.dim = true; part.color = '#808080' })
    }
  }
  return lines
}
