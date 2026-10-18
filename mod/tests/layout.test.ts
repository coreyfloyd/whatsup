import { describe, expect, test } from 'claude-code/testing'

import { FOOTER, NO_PAGE, OPEN_LABEL, barCells, clip, fitCard, paneLines, placeCard, wrap } from '../hooks/layout'
import { cells } from '../hooks/session-facts'
import { SNAPSHOTS } from '../hooks/snapshots'

describe('card placement', () => {
  test('every card of every snapshot stays inside the pane window, its head line first and whole', () => {
    for (const [name, entry] of Object.entries(SNAPSHOTS)) {
      for (const [columns, windowRows] of [[110, 50], [72, 30], [40, 12], [24, 8], [12, 4], [8, 3], [6, 2]] as const) {
        const lines = paneLines(entry.snapshot, name, columns - 2)
        lines.forEach((line, row) => {
          if (!line.item) return
          const head = line.item.page === null ? NO_PAGE : OPEN_LABEL
          for (const offset of [0, Math.max(0, row - windowRows + 1), row]) {
            if (row < offset || row >= offset + windowRows) continue
            const box = placeCard(head, line.item.details, row, offset, windowRows, columns)
            const height = box.lines.length + (box.bordered ? 2 : 0)
            const first = row - offset + box.top
            const where = `${name} ${line.item.key} ${columns}x${windowRows} offset ${offset}`
            expect(first >= 0, `${where} starts inside`).toBe(true)
            expect(first + height <= windowRows, `${where} ends inside`).toBe(true)
            expect(box.width <= columns, `${where} fits across`).toBe(true)
            const inner = box.width - (box.bordered ? 4 : 0)
            for (const text of box.lines) expect(text.length <= inner, `${where} line fits`).toBe(true)
            if (inner >= head.length) expect(box.lines[0], `${where} head`).toBe(head)
          }
        })
      }
    }
  })

  test('a card sits below its item when it fits, above when only that fits', () => {
    expect(placeCard(OPEN_LABEL, ['a', 'b'], 2, 0, 20, 40).top).toBe(1)
    expect(placeCard(OPEN_LABEL, ['a', 'b'], 18, 0, 20, 40).top).toBe(-5)
  })

  test('a card that fits neither side takes the roomier one and ends with … N more lines', () => {
    const details = Array.from({ length: 30 }, (_, index) => `line ${index}`)
    const below = placeCard(OPEN_LABEL, details, 3, 0, 12, 40)
    expect(below.top).toBe(1)
    expect(below.lines).toEqual([OPEN_LABEL, 'line 0', 'line 1', 'line 2', 'line 3', '… 26 more lines'])
    const above = placeCard(NO_PAGE, details, 9, 0, 12, 40)
    expect(above.top).toBe(-9)
    expect(above.lines).toHaveLength(7)
    expect(above.lines[0]).toBe(NO_PAGE)
    expect(above.lines[6]).toBe('… 25 more lines')
  })

  test('a window too short for either side is covered whole, keeping the head line', () => {
    const box = placeCard(OPEN_LABEL, ['a', 'b', 'c', 'd', 'e'], 2, 0, 5, 40)
    expect(box.top).toBe(-2)
    expect(box.lines).toEqual([OPEN_LABEL, 'a', '… 4 more lines'])
    expect(placeCard(OPEN_LABEL, ['a', 'b'], 0, 0, 1, 40).lines).toEqual([OPEN_LABEL])
  })

  test('fitCard keeps short cards whole and counts the rest', () => {
    expect(fitCard(['a', 'b'], 2)).toEqual(['a', 'b'])
    expect(fitCard(['a', 'b', 'c', 'd'], 3)).toEqual(['a', 'b', '… 2 more lines'])
    expect(fitCard(['a', 'b', 'c', 'd'], 3, 8)).toEqual(['a', 'b', '… 2 more'])
  })

  test('no detail names a page: the head line carries it', () => {
    for (const [name, entry] of Object.entries(SNAPSHOTS)) {
      for (const line of paneLines(entry.snapshot, name, 70)) {
        if (line.item) expect(line.item.details.some(text => /^Page:|No page|https?:/.test(text)), `${name} ${line.item.key}`).toBe(false)
      }
    }
  })

  test('the footer explains both markers', () => {
    expect(FOOTER).toContain('▸')
    expect(FOOTER).toContain('↗')
  })
})

describe('text', () => {
  test('wrap keeps every line within the width and hangs checklist continuations', () => {
    const lines = wrap('- [ ] Each progress set reports N closed of M, counting a ticket as closed for any close reason.', 30)
    for (const line of lines) expect(line.length <= 30).toBe(true)
    expect(lines[0]!.startsWith('- [ ] Each')).toBe(true)
    expect(lines[1]!.startsWith('      ')).toBe(true)
    expect(wrap('https://github.com/example/project/issues/1234567', 12).every(line => line.length <= 12)).toBe(true)
    expect(wrap('- [x] first\n  second', 40)).toEqual(['- [x] first', '  second'])
  })

  test('Unicode clipping and detail wrapping use terminal cells without splitting code points', () => {
    expect(cells('open ↗')).toBe(6)
    expect(cells('⚠️')).toBe(2)
    expect(cells('🌿')).toBe(2)
    expect(cells('文')).toBe(2)
    expect(cells('e\u0301')).toBe(1)
    expect(clip('文文文', 4)).toBe('文…')
    expect(clip('🌿🌿🌿', 4)).toBe('🌿…')
    expect(clip('e\u0301e\u0301', 2)).toBe('e\u0301e\u0301')
    for (const width of [36, 76]) for (const value of ['文'.repeat(100), '🌿 report '.repeat(30)]) {
      const lines = wrap(value, width)
      for (const line of lines) expect(cells(line) <= width, line).toBe(true)
      expect(lines.join('').replace(/\s/g, '')).toBe(value.replace(/\s/g, ''))
    }
  })

  test('clip folds newlines and marks the cut', () => {
    expect(clip('a\nb', 10)).toBe('a b')
    expect(clip('abcdef', 4)).toBe('abc…')
  })
})

describe('bars', () => {
  test('the fill is full only when every ticket is closed and shows any closed ticket', () => {
    expect(barCells(0, 4, 8)).toBe('░░░░░░░░')
    expect(barCells(1, 40, 8)).toBe('█░░░░░░░')
    expect(barCells(39, 40, 8)).toBe('███████░')
    expect(barCells(4, 4, 8)).toBe('████████')
  })
})
