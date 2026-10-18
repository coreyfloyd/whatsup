import { describe, expect, test } from 'claude-code/testing'
import { reportLines } from '../hooks/report-layout'
import { cells } from '../hooks/session-facts'
import { reportError } from '../hooks/report'

const section = { label: 'Work', verb: 'finished', item_kind: 'tasks' }
const text = (line: ReturnType<typeof reportLines>[number]) => (line.prefix ?? '') + (line.marker ?? '') + line.parts.map(p => p.text).join('') + (line.suffix ?? '')

describe('report boundaries', () => {
  for (const columns of [40, 80]) test(`one top spacer in populated, empty and unavailable sections at ${columns}`, () => {
    for (const variant of [section, { ...section, description: 'Read the supplied brief' },
      { ...section, items: [{ title: 'Read the brief', state: 'active' as const }] },
      { ...section, enrichment: { state: 'unavailable' as const, reason: 'GitHub read timed out' } }]) {
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
