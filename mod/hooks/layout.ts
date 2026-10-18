// Turns one snapshot into the pane's lines and each item's card. Plain data,
// no drawing. Counts, membership and pages come from the snapshot as read;
// nothing is derived here.

import { cells, fit } from './session-facts'
import type { NotRecorded, ProgressSet, Row, Section, SetCard, Snapshot, TicketCard } from './snapshot'

export type Part = { text: string; dim?: boolean; bold?: boolean; underline?: boolean; color?: string }

export type Item = {
  /** Unique within the pane; addresses the item's Box and Buttons. */
  key: string
  /** The source-supplied page, or null: such an item opens nothing. */
  page: string | null
  /** The card's logical detail lines, unwrapped; the page is not among them. */
  details: string[]
}

export type Line = { key: string; parts: Part[]; item?: Item }

const BAR_LABEL = 10
/** Every item line starts with its `▸` marker. */
export const MARKER_WIDTH = 2
export const FOOTER = '▸ shows details · open ↗ opens the page in your browser'
export const OPEN_LABEL = 'open ↗'
export const NO_PAGE = 'No page'
const NOT_RECORDED = 'Not recorded'
const SET_NAMES = { milestone: 'Milestone', epic: 'Epic', slate: 'Slate' } as const

/** One row of text: newlines and tabs folded, clipped to `width` cells with an ellipsis. */
export function clip(text: string, width: number): string {
  const flat = text.replace(/[\t\r\n]+/g, ' ')
  if (width <= 0) return ''
  return cells(flat) <= width ? flat : fit(flat, width - 1) + '…'
}

function listText(value: string[] | NotRecorded, empty: string): string {
  if (value === NOT_RECORDED) return NOT_RECORDED
  return value.length === 0 ? empty : value.join(', ')
}

function countText(set: ProgressSet): string {
  return set.total === 0 ? 'no tickets' : `${set.closed}/${set.total} closed`
}

/** The bar's fill: full only when every ticket is closed, never empty once one is. */
export function barCells(closed: number, total: number, width: number): string {
  const share = closed === total ? width : Math.min(width - 1, Math.max(closed > 0 ? 1 : 0, Math.round((closed / total) * width)))
  return '█'.repeat(share) + '░'.repeat(width - share)
}

function setCard(kind: 'milestone' | 'epic' | 'slate', set: ProgressSet): string[] {
  const card: Section<SetCard> = set.card
  const name = SET_NAMES[kind]
  if (card.state !== 'present' || card.value === null) {
    return [`${name}: ${set.identity}`, `Progress: ${countText(set)}`, `Couldn't load ${kind} details`]
  }
  const value = card.value
  if (kind === 'slate') {
    return [`Slate: ${value.identity}`, `Revision: ${value.revision ?? NOT_RECORDED}`, `Progress: ${countText(set)}`]
  }
  return [
    `${name}: ${value.name ?? NOT_RECORDED}`,
    `Objective: ${value.objective ?? NOT_RECORDED}`,
    `Progress: ${countText(set)}`,
    `Blockers: ${listText(value.blockers ?? NOT_RECORDED, 'none')}`,
  ]
}

function rowLabel(row: Row): string {
  // Unknown (null) still names the repository, as the read contract asks.
  const repository = row.different_repository === false ? '' : row.repository
  return `${repository}#${row.number}`
}

function ticketCard(row: Row): string[] {
  const head = `${rowLabel(row)} ${row.title}`
  const card: Section<TicketCard> = row.card
  if (card.state !== 'present' || card.value === null) {
    return [head, "Couldn't load ticket details"]
  }
  const value = card.value
  const criteria = value.acceptance_criteria === NOT_RECORDED
    ? [`Acceptance criteria: ${NOT_RECORDED}`]
    : value.acceptance_criteria.length === 0 ? ['Acceptance criteria: none'] : ['Acceptance criteria:', ...value.acceptance_criteria]
  const labels = value.status.labels === NOT_RECORDED ? NOT_RECORDED : value.status.labels.join(', ') || 'no status label'
  return [
    head,
    `Requested outcome: ${value.requested_outcome}`,
    ...criteria,
    `Status: ${value.status.state} · ${labels}`,
    `Blockers: ${listText(value.blockers, 'none')}`,
  ]
}

/** The pane's lines for one snapshot, each clipped to `columns`, the text after an item's marker. */
export function paneLines(snapshot: Snapshot, snapshotName: string, columns: number): Line[] {
  const lines: Line[] = []
  const text = (key: string, value: string, style: Omit<Part, 'text'> = {}) =>
    lines.push({ key, parts: [{ text: clip(value, columns), ...style }] })
  const item = (key: string, value: string, entry: Omit<Item, 'key'>) =>
    lines.push({ key, parts: [{ text: clip(value, columns) }], item: { key, ...entry } })

  text('source', `Recorded snapshot: ${snapshotName}`, { dim: true })

  const { project, milestone, scope, progress } = snapshot
  if (project.state === 'unavailable') text('project', "Couldn't load project")
  else if (project.state === 'present' && project.value) {
    const value = project.value
    const shown = value.progress_sets.map(kind => SET_NAMES[kind as keyof typeof SET_NAMES] ?? kind)
    item('project', `Project: ${value.name}`, {
      page: value.page,
      details: [
        `Project: ${value.name}`,
        `Scope: ${value.scope ?? NOT_RECORDED}`,
        `Progress sets shown: ${shown.length === 0 ? 'none' : shown.join(', ')}`,
      ],
    })
  }

  if (milestone.state === 'unavailable') text('milestone', "Couldn't load milestone")
  else if (milestone.state === 'present' && milestone.value) {
    const value = milestone.value
    const bar = progress.milestone
    const card = bar.state === 'present' && bar.value && bar.value.identity === value.identity
      ? setCard('milestone', bar.value)
      : [
          `Milestone: ${value.name}`,
          `Objective: ${value.objective}`,
          bar.state === 'unavailable' ? "Progress: Couldn't load milestone" : `Progress: ${NOT_RECORDED}`,
        ]
    item('milestone', `Milestone: ${value.name}`, { page: value.page, details: card })
  }

  if (scope.state === 'unavailable' || scope.value === null) text('scope', "Couldn't load scope")
  else if (scope.value.authority === null) text('scope', scope.value.text)
  else {
    text('scope', `Scope: ${scope.value.text}`)
    if (scope.value.label !== null) text('scope-source', `  ${scope.value.label}`, { dim: true })
  }

  const bars = (['milestone', 'epic', 'slate'] as const).filter(kind => progress[kind].state !== 'hidden')
  if (bars.length > 0) lines.push({ key: 'gap-bars', parts: [{ text: ' ' }] })
  for (const kind of bars) {
    const section = progress[kind]
    const label = SET_NAMES[kind].padEnd(BAR_LABEL)
    if (section.state === 'unavailable' || section.value === null) {
      text(`bar-${kind}`, `${label}Couldn't load ${kind}`)
      continue
    }
    const set = section.value
    const page = set.card.state === 'present' && set.card.value ? set.card.value.page : null
    const count = countText(set)
    const width = Math.max(4, Math.min(24, columns - BAR_LABEL - count.length - 1))
    const parts: Part[] = set.total === 0
      ? [{ text: clip(label + count, columns) }]
      : [{ text: label }, { text: barCells(set.closed, set.total, width) }, { text: ' ' + count }]
    const used = parts.reduce((sum, part) => sum + part.text.length, 0)
    const fitted = used <= columns ? parts : [{ text: clip(label + count, columns) }]
    lines.push({ key: `bar-${kind}`, parts: fitted, item: { key: `bar-${kind}`, page, details: setCard(kind, set) } })
  }

  lines.push({ key: 'gap-rows', parts: [{ text: ' ' }] })
  text('heading-rows', 'In progress', { bold: true })
  const inProgress = snapshot.in_progress
  if (inProgress.state !== 'present' || inProgress.value === null) text('rows-message', "Couldn't load in progress")
  else if (inProgress.value.rows.length === 0) text('rows-message', inProgress.value.message ?? 'Nothing in progress')
  else {
    for (const row of inProgress.value.rows) {
      const page = row.card.state === 'present' && row.card.value ? row.card.value.page : null
      item(`row-${row.identity}`, `${rowLabel(row)} ${row.title}`, { page, details: ticketCard(row) })
    }
  }
  return lines
}

/** Word-wraps one logical detail line to `width`, continuation lines indented under its text. */
export function wrap(line: string, width: number): string[] {
  const out: string[] = []
  for (const paragraph of line.split('\n')) {
    const indent = paragraph.match(/^\s*/)?.[0] ?? ''
    const checklist = /^- \[[ xX]\] /.test(paragraph.slice(indent.length))
    const hang = ' '.repeat(Math.min(indent.length + (checklist ? 6 : 2), Math.max(0, width - 8)))
    let current = indent
    let fresh = true
    for (const word of paragraph.slice(indent.length).split(/\s+/).filter(Boolean)) {
      let rest = word
      while (rest.length > 0) {
        const room = width - cells(current) - (fresh ? 0 : 1)
        if (cells(rest) <= room) {
          current += (fresh ? '' : ' ') + rest
          rest = ''
          fresh = false
        } else if (!fresh) {
          out.push(current)
          current = hang
          fresh = true
        } else {
          const take = Math.max(1, width - cells(current))
          const piece = fit(rest, take)
          out.push(current + (piece || clip(rest, take)))
          rest = rest.slice(piece.length || [...rest][0]!.length)
          current = hang
        }
      }
    }
    if (!fresh || out.length === 0 || current.trim().length > 0) out.push(current)
  }
  return out.map(text => fit(text, width))
}

/** The card's rows within `rows`: the overflow replaced by "… N more lines", shortened only where the card is too narrow for it. */
export function fitCard(lines: string[], rows: number, width = Infinity): string[] {
  if (lines.length <= rows) return lines
  if (rows <= 0) return []
  const kept = lines.slice(0, rows - 1)
  const hidden = lines.length - kept.length
  const marker = [`… ${hidden} more lines`, `… ${hidden} more`, `…${hidden}`].find(text => text.length <= width) ?? '…'
  return [...kept, marker]
}

export type CardBox = {
  /** Offset from the item's row: 1 directly below, negative above. */
  top: number
  width: number
  bordered: boolean
  lines: string[]
}

const CARD_MAX_WIDTH = 80

/**
 * Seats a card inside the pane's window without covering its item: below the
 * item when it fits there, above when it fits there, otherwise on the roomier
 * side, truncated. A window too short for that is covered whole.
 *
 * The first line is `head`, the card's action line; the details follow.
 * `row` is the item's row in the tree, `offset` the window's first row and
 * `windowRows` how many rows the window shows.
 */
export function placeCard(head: string, details: string[], row: number, offset: number, windowRows: number, columns: number): CardBox {
  const width = Math.max(1, Math.min(columns, CARD_MAX_WIDTH))
  const bordered = width >= 8 && windowRows >= 3
  const frame = bordered ? 2 : 0
  const inner = width - (bordered ? 4 : 0)
  // The head line (open ↗ or No page) is never wrapped and never cut off.
  const wrapped = [clip(head, inner), ...details.flatMap(line => wrap(line, inner))]
  const fit = (rows: number) => (rows <= 1 ? wrapped.slice(0, 1) : fitCard(wrapped, rows, inner))
  const seen = Math.min(Math.max(row - offset, 0), Math.max(windowRows - 1, 0))
  const below = windowRows - seen - 1
  const above = seen
  const full = wrapped.length + frame
  if (full <= below) return { top: 1, width, bordered, lines: wrapped }
  if (full <= above) return { top: -full, width, bordered, lines: wrapped }
  const side = Math.max(below, above)
  if (side >= frame + 2) {
    const lines = fit(side - frame)
    return { top: below >= above ? 1 : -side, width, bordered, lines }
  }
  return { top: -seen, width, bordered, lines: fit(Math.max(1, windowRows - frame)) }
}
