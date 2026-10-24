import type { AnswerStates } from '../hooks/decision-input'
import { decision } from './fixtures/decision'
import { decisionVersion } from '../hooks/report'
import { describe, expect, test } from 'claude-code/testing'
import { reportLines } from '../hooks/report-layout'
import { cells } from '../hooks/session-facts'
import { reportError } from '../hooks/report'

const section = { label: 'Work', verb: 'finished', item_kind: 'tasks' }
const text = (line: ReturnType<typeof reportLines>[number]) => (line.prefix ?? '') + (line.marker ?? '') + line.parts.map(p => p.text).join('') + (line.suffix ?? '')

describe('report boundaries', () => {
  test('decision prose remains complete at supported widths, including long Unicode questions', () => {
    for (const columns of [80, 58, 40]) {
      const value = { ...decision, question: decision.question.repeat(8) + '文🌿', context: decision.context.repeat(12) }
      for (const expanded of [undefined, decisionVersion(value)]) {
        const rows = reportLines({ scope: 'Design pending decisions', decisions: [value] }, columns, [], undefined, undefined, expanded).slice(1)
        for (const row of rows) expect(cells(text(row)) + (row.action?.hotkey || row.key === 'decision-0' ? 3 : 0), row.key).toBe(columns)
        const prose = rows.map(text).join('').replace(/[│ ]/g, '')
        expect(prose).toContain(value.question.replace(/ /g, ''))
        if (expanded) {
          expect(prose).toContain(value.context.replace(/ /g, ''))
          for (const option of value.options) for (const field of ['label', 'benefit', 'cost'] as const) expect(prose).toContain(option[field].replace(/ /g, ''))
        } else expect(prose).not.toContain('CONTEXT')
      }
    }
  })
  test('decision buttons reserve the engine-rendered hotkey cells', () => {
    for (const columns of [40, 58, 80]) {
      const rows = reportLines({ scope: 'Design pending decisions', decisions: [decision] }, columns, [], undefined, undefined, decisionVersion(decision))
      for (const row of rows.filter(row => row.action?.hotkey || row.key === 'decision-0')) expect(cells(text(row)) + 3).toBe(columns)
    }
  })
  // Keep each test well below the runner's default timeout while retaining
  // all 75 widths and the full expansion/capability matrix for every state.
  for (const status of ['pending', 'sending', 'sent', 'unconfirmed', 'failed'] as const) for (let firstColumn = 6; firstColumn <= 80; firstColumn += 5) {
    test(`every decision row fits ${firstColumn}–${firstColumn + 4} columns in ${status} state`, () => {
      const decisions = [decision, { ...decision, identity: 'second' }]
      const answers: AnswerStates = Object.fromEntries(decisions.map(d => [d.identity, {
        version: decisionVersion(d), selected: d.options[0]!.identity,
        ...(status === 'pending' ? {} : { receipt: { attempt: 'width-check', option: d.options[0]!, status, reason: 'Policy refused this input' }, discussion: { attempt: 'discussion-width', status, reason: 'Policy refused this input' } }),
      }]))
      for (let columns = firstColumn; columns < firstColumn + 5; columns++) for (const expanded of [undefined, decisionVersion(decision), decisionVersion(decisions[1]!)]) for (const inputAvailable of [true, false]) {
        const rows = reportLines({ scope: 'Design pending decisions', decisions }, columns, [], undefined, undefined, expanded, answers, inputAvailable).slice(1)
        for (const row of rows) {
          const hotkey = row.action?.hotkey || row.decision?.hotkey
          // Native Buttons add "k: " outside the model's text children.
          const width = cells(text(row)) + (hotkey ? 3 : 0)
          expect(width <= columns, `${columns} columns, ${row.key}: ${text(row)}`).toBe(true)
        }
        const heading = text(rows.find(row => row.key === 'decision-0')!)
        const expectedStatus = { pending: /ANSWER NEEDED|Answer/, sending: /SENDING|Wait/, sent: /SENT|Sent/, unconfirmed: /UNCONFIRMED|Unsure/, failed: /ANSWER NEEDED|Retry/ }[status]
        expect(expectedStatus.test(heading), heading).toBe(true)
        // Full prose remains in wrapped rows rather than being clipped away.
        const prose = rows.map(row => row.parts.map(p => p.text).join('')).join('').replace(/\s/g, '')
        expect(prose).toContain(decision.question.replace(/\s/g, ''))
        if (status === 'sent' || status === 'sending' || status === 'unconfirmed') expect(prose).toContain(decision.options[0]!.label.replace(/\s/g, ''))
        if (expanded && (status === 'pending' || status === 'failed')) for (const option of decision.options) for (const field of ['label', 'benefit', 'cost'] as const) expect(prose).toContain(option[field].replace(/\s/g, ''))
      }
    })
  }
  test('decision version covers answer-relevant content, independent of object field order', () => {
    expect(decisionVersion({ recommendation: decision.recommendation, options: decision.options, context: decision.context, why_now: decision.why_now, question: decision.question, identity: decision.identity })).toBe(decisionVersion(decision))
    for (const field of ['question', 'why_now', 'context'] as const) expect(decisionVersion({ ...decision, [field]: decision[field] + ' ' })).not.toBe(decisionVersion(decision))
    expect(decisionVersion({ ...decision, options: [...decision.options].reverse() })).not.toBe(decisionVersion(decision))
    expect(decisionVersion({ ...decision, recommendation: { ...decision.recommendation, reason: 'Changed' } })).not.toBe(decisionVersion(decision))
  })
  for (const columns of [40, 80]) test(`one top spacer in populated, named and unavailable sections at ${columns}`, () => {
    for (const variant of [{ ...section, name: 'Public release' }, { ...section, description: 'Read the supplied brief' },
      { ...section, items: [{ title: 'Read the brief', state: 'active' as const }] },
      { ...section, name: 'Public release', enrichment: { state: 'unavailable' as const, reason: 'GitHub read timed out' } }]) {
      for (const expanded of [[], [0]]) {
        const rows = reportLines({ scope: 'Read the brief', sections: [variant] }, columns, expanded).slice(1)
        expect(rows[1].key).toBe('section-0-top-space')
        expect(text(rows[1])).toBe('│' + ' '.repeat(columns - 2) + '│')
        expect(rows.filter(row => row.key === 'section-0-top-space')).toHaveLength(1)
        if (!('items' in variant) && !('enrichment' in variant) && !expanded.length) {
          expect(rows.map(row => row.key)).toEqual(['section-0', 'section-0-top-space', 'section-0-bottom'])
        }
      }
    }
  })
  test('sections without a name, description or items produce no rows, even when expanded', () => {
    for (const columns of [58, 80]) for (const expanded of [[], [0, 1, 2]]) {
      const lines = reportLines({ scope: 'Read the brief', sections: [
        section,
        { ...section, name: '', description: '', items: [] },
        { ...section, enrichment: { state: 'unavailable', reason: 'GitHub read timed out' } },
      ] }, columns, expanded)
      expect(lines.map(line => line.key)).toEqual(['scope'])
    }
  })
  test('empty sections retain boxes and expanded content without counts or bars', () => {
    const lines = reportLines({ scope: 'Read the brief', sections: [{ ...section, description: 'Read the supplied brief' }] }, 40, [0])
    expect(lines.map(text).join('\n')).toContain('Read the supplied brief')
    expect(lines.map(text).join('\n')).toContain('tasks')
    expect(lines.some(line => line.badge || line.key.endsWith('-bar'))).toBe(false)
    expect(lines.map(text).join('\n')).toContain('┌')
    expect(lines.map(text).join('\n')).toContain('└')
  })
  test('zero percent and full completion keep both badges and bars', () => {
    for (const state of ['queued', 'done'] as const) {
      const lines = reportLines({ scope: 'Read the brief', sections: [{ ...section, items: [{ title: 'Read the brief', state }] }] }, 40)
      expect(lines.find(line => line.badge)?.badge).toBe(state === 'done' ? '1/1' : '0/1')
      expect(text(lines.find(line => line.key.endsWith('-bar'))!)).toContain(state === 'done' ? '100%' : '0%')
    }
  })
  test('long labels and count verbs stay within 40 and 80 columns', () => {
    for (const columns of [40, 80]) {
      const lines = reportLines({ scope: 'Build the whatsup report tool and section boxes', sections: [{ ...section, label: 'Build the whatsup report tool and section boxes', verb: 'Build the whatsup report tool and section boxes', items: [{ title: 'Read the brief', state: 'active' }] }] }, columns, [0])
      for (const line of lines) expect(text(line).length <= columns, text(line)).toBe(true)
    }
  })
  test('validates optional fields, nested item tasks and every type before accepting', () => {
    const valid = { scope: 'Read the brief', sections: [{ ...section, fields: [{ label: 'Source', value: 'brief.md' }] }], workers: [{ name: 'generator', role: 'main', status: 'testing', state: 'running', task: { title: 'Read the brief', state: 'done' }, tokens: [0, 10], total: 10 }] }
    expect(reportError(valid)).toBe(null)
    for (const [input, field] of [
      [null, 'report'], [{}, 'scope'], [{ scope: 'Read', sections: null }, 'sections'],
      [{ scope: 'Read', sections: [{ ...section, items: [{ title: 'Read', state: 'active', number: 0 }] }] }, 'number'],
      [{ scope: 'Read', workers: [{ ...valid.workers[0], tokens: [-1] }] }, 'tokens[0]'],
      [{ scope: 'Read', workers: [{ ...valid.workers[0], task: 10 }] }, 'task'],
    ] as const) expect(reportError(input)).toContain(field)
  })
  test('Unicode section titles, badges and expanded rows align in terminal cells', () => {
    for (const columns of [40, 80]) for (const value of ['文'.repeat(60), '🌿 work '.repeat(16), 'e\u0301'.repeat(100)]) for (const failed of [false, true]) {
      // Boundary variants of the existing report fixture; the text is not a live report.
      const lines = reportLines({ scope: value, sections: [{ ...section,
        label: value, name: value, verb: value, description: value, item_kind: value,
        items: [{ title: value, state: 'active', number: 10, ...(failed ? { enrichment: { state: 'unavailable', reason: value } } : {}) }],
      }] }, columns, [0])
      for (const line of lines) {
        expect(cells(text(line)) <= columns, line.key + ': ' + text(line)).toBe(true)
        if (line.key.startsWith('section-')) expect(cells(text(line)), line.key).toBe(columns)
      }
    }
  })

})
