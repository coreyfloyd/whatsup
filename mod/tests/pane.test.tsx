import { describe, expect, test } from 'claude-code/testing'
import type { Engine, Mounted } from 'claude-code/testing'
import type { On, RenderSurface } from 'claude-code'

const REPO = 'example/project'
const SURFACES = ['terminal', 'desktop'] as const

type Pane = Mounted<RenderSurface, 'Pane'>

function paneProps(columns: number, rows: number, placement: 'dock' | 'inline' = 'dock') {
  return {
    title: 'Session Status',
    isFocused: false,
    bodyColumns: columns,
    placement,
    scroll: { offset: 0, bodyRows: rows },
    view: {},
  }
}

/** Answers the host calls a pane makes, beneath the plugin, and records page opens. */
function host(on: On) {
  const opened: string[][] = []
  const panes: string[] = []
  on('process.run', (_$, e) => {
    opened.push([...e.argv])
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('ui.open', (_$, e) => {
    panes.push(e.id)
    return { value: { isPlaced: true as const } }
  })
  on('session.id', () => ({ value: 'snapshot-test-session' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  return { opened, panes }
}

async function mount($: Engine, surface: RenderSurface, columns = 72, rows = 80, placement: 'dock' | 'inline' = 'dock') {
  return $.ui.mount({
    plugin: 'whatsup',
    surface,
    component: 'Pane',
    requestId: 'session-status',
    props: paneProps(columns, rows, placement),
    viewport: { columns: columns + 40, rows: rows + 6, isFullscreen: placement === 'dock' },
  })
}

/** Every child of the root Box but the card: one per row, each padded to the pane's width. */
async function paneRows(ui: Pane): Promise<string[]> {
  const root = (await ui.drawn()) as Drawn
  return (root.children ?? []).filter(child => (child as Drawn).props?.position !== 'absolute').map(textOf)
}

/** The text of each line of the pane, in order, without its padding and without the rows below the footer. */
async function lineTexts(ui: Pane): Promise<string[]> {
  const root = (await ui.drawn()) as Drawn
  return (root.children as Drawn[])
    .filter(child => child.props?.position !== 'absolute' && !String(child.props?.key).startsWith('hide-below-'))
    .map(child => textOf(child).trimEnd())
}

/** The shown cards, each as its item key and its lines inside the border, padding trimmed. */
async function cards(ui: Pane): Promise<{ key: string; lines: string[] }[]> {
  const root = (await ui.drawn()) as Drawn
  return (root.children as Drawn[])
    .filter(child => child.props?.position === 'absolute')
    .map(card => ({
      key: String(card.props?.key).replace(/^card-/, ''),
      lines: (card.children as Drawn[])
        .filter(line => !/-(top|bottom)$/.test(String(line.props?.key)))
        .map(line => textOf(line).replace(/^│ /, '').replace(/ │$/, '').trimEnd()),
    }))
}

async function cardOf(ui: Pane, key: string): Promise<string[]> {
  const shown = await cards(ui)
  expect(shown.map(card => card.key), `only ${key}'s card is shown`).toEqual([key])
  return shown[0]!.lines
}

type Drawn = { type?: string; props?: Record<string, unknown>; hover?: unknown; children?: unknown[] }

function textOf(node: unknown): string {
  if (typeof node === 'string') return node
  if (node === null || typeof node !== 'object') return ''
  const element = node as Drawn
  const children = element.children ?? []
  const label = typeof element.props?.label === 'string' && children.length === 0 ? element.props.label : ''
  return label + children.map(textOf).join('')
}

/** Every element of a drawn tree. */
function elements(node: unknown): Drawn[] {
  if (node === null || typeof node !== 'object') return []
  const element = node as Drawn
  return [element, ...(element.children ?? []).flatMap(elements)]
}

function snapshotTest(snapshot: string, name: string, body: (ui: Pane, opened: string[][], $: Engine) => Promise<void>) {
  test(`${snapshot}: ${name}`, { options: { snapshot } }, async ($, on) => {
    const { opened } = host(on)
    for (const surface of SURFACES) {
      await $.command.run({ command: 'session-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
      const ui = await mount($, surface)
      await body(ui, opened, $)
      opened.length = 0
      await ui.unmount()
    }
  })
}

const run = ($: Engine) =>
  $.command.run({ command: 'session-status', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })

describe('opening', () => {
  test('the pane opens only from /session-status', { options: { snapshot: 'several-rows' } }, async ($, on) => {
    const { panes } = host(on)
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    expect(panes).toEqual([])
    const ran = await run($)
    expect(panes).toEqual(['session-status'])
    expect(ran.text).toContain('recorded snapshot "several-rows"')
  })

  test('the pane and every card draw within the pane at any width', { options: { snapshot: 'several-rows' } }, async ($, on) => {
    host(on)
    for (const [columns, rows, placement] of [[110, 40, 'dock'], [72, 40, 'dock'], [24, 10, 'inline'], [12, 10, 'inline']] as const) {
      const ui = await mount($, 'terminal', columns, rows, placement)
      for (const line of await paneRows(ui)) expect(line.length <= columns, `"${line}" fits ${columns}`).toBe(true)
      for (const key of ['project', 'milestone', 'bar-milestone', 'bar-epic', 'bar-slate', `row-${REPO}#3`, `row-${REPO}#4`]) {
        await ui.press({ key: `show-${key}` })
        const root = (await ui.drawn()) as Drawn
        const card = (root.children as Drawn[]).find(child => child.props?.position === 'absolute')!
        expect(Number(card.props?.width) <= columns, `${key} card fits ${columns}`).toBe(true)
      }
      await ui.unmount()
    }
  })

  test('every card row stays inside the card and the pane at 6 to 9 columns', { options: { snapshot: 'several-rows' } }, async ($, on) => {
    host(on)
    for (const columns of [9, 8, 7, 6]) {
      await run($)
      const ui = await mount($, 'terminal', columns, 10, 'inline')
      await ui.press({ key: 'show-bar-epic' })
      const root = (await ui.drawn()) as Drawn
      const card = (root.children as Drawn[]).find(child => child.props?.position === 'absolute')!
      const width = Number(card.props?.width)
      expect(width <= columns, `card fits ${columns}`).toBe(true)
      for (const line of card.children as Drawn[]) {
        expect(textOf(line).length, `"${textOf(line)}" spans the card at ${columns}`).toBe(width)
      }
      // Bordered at 8 and 9 columns, the inner width is under open ↗'s six, so the head is clipped as placeCard clips it.
      // Unbordered at 6 and 7, it fits whole.
      expect(textOf(await ui.find({ key: 'open-bar-epic' }))).toBe({ 9: 'open…', 8: 'ope…', 7: 'open ↗', 6: 'open ↗' }[columns])
      await ui.unmount()
    }
  })

  test('reopening the pane starts with no card', { options: { snapshot: 'several-rows' } }, async ($, on) => {
    host(on)
    await run($)
    const ui = await mount($, 'terminal')
    await ui.press({ key: 'show-bar-epic' })
    expect(await cards(ui)).toHaveLength(1)
    await ui.unmount()
    await run($)
    const reopened = await mount($, 'terminal')
    expect(await cards(reopened)).toHaveLength(0)
  })
})

describe('several rows', () => {
  snapshotTest('several-rows', 'header, three bars, two rows, footer, no card', async (ui, _opened) => {
    const lines = await lineTexts(ui)
    expect(lines).toContain('  Recorded snapshot: several-rows')
    expect(lines).toContain('▸ Project: Session Status')
    expect(lines).toContain('▸ Milestone: Initial build')
    expect(lines).toContain('  Scope: Build Session Status initial slices')
    expect(lines).toContain(`    from epic ${REPO}#2`)
    expect(lines.filter(line => /^▸ (Milestone|Epic|Slate) +█*░+ \d+\/\d+ closed$/.test(line))).toHaveLength(3)
    expect(lines).toContain('▸ #3 Build read module header and progress bars')
    expect(lines).toContain('▸ #4 Add in-progress rows to the read module')
    expect(lines.filter(line => line.includes('▸ shows details · open ↗ opens the page'))).toHaveLength(1)
    expect(await cards(ui)).toHaveLength(0)
    const text = lines.join('\n')
    for (const word of [/goal/i, /completed/i, /delivered/i, /%/, /\bas of\b/i, /\d{4}-\d{2}-\d{2}T/, /\blive\b/i]) {
      expect(word.test(text), `pane lines never match ${word}`).toBe(false)
    }
  })

  snapshotTest('several-rows', 'nothing uses hover and nothing is pushed down', async ui => {
    const before = await lineTexts(ui)
    await ui.press({ key: `show-row-${REPO}#3` })
    expect(await lineTexts(ui)).toEqual(before)
    for (const element of elements(await ui.drawn())) {
      expect(element.hover, `${element.type} has no hover`).toBeUndefined()
      expect(element.props?.display, `${element.type} is never hidden by style`).toBeUndefined()
    }
  })

  snapshotTest('several-rows', 'one card at a time: a press shows, another swaps, the same hides', async (ui, opened) => {
    await ui.press({ key: `show-row-${REPO}#3` })
    expect((await cardOf(ui, `row-${REPO}#3`))[1]).toBe('#3 Build read module header and progress bars')
    await ui.press({ key: 'show-bar-epic' })
    await cardOf(ui, 'bar-epic')
    await ui.press({ key: 'show-bar-epic' })
    expect(await cards(ui)).toHaveLength(0)
    expect(opened).toEqual([])
  })

  snapshotTest('several-rows', 'a press anywhere else in the pane hides the card', async (ui, opened) => {
    for (const elsewhere of ['hide-source', 'hide-scope', 'hide-heading-rows', 'hide-footer-0', 'hide-card-bar-epic-1']) {
      await ui.press({ key: 'show-bar-epic' })
      expect(await cards(ui)).toHaveLength(1)
      await ui.press({ key: elsewhere })
      expect(await cards(ui), `${elsewhere} hides the card`).toHaveLength(0)
    }
    expect(opened).toEqual([])
  })

  snapshotTest('several-rows', 'every row of the pane is pressable to its right edge', async ui => {
    const root = (await ui.drawn()) as Drawn
    const lines = (root.children as Drawn[]).filter(child => child.props?.position !== 'absolute')
    // 80 window rows: the content, then hide rows down to the pane's bottom.
    expect(lines).toHaveLength(80)
    expect(lines.filter(line => String(line.props?.key).startsWith('hide-below-')).length > 0).toBe(true)
    for (const line of lines) {
      const text = textOf(line)
      expect(text.length, `"${text.trimEnd()}" reaches the right edge`).toBe(72)
      // Each row is one Button, or a Box of Buttons only: no cell is plain Text.
      const parts = line.type === 'Button' ? [line] : (line.children as Drawn[])
      for (const part of parts) expect(part.type, `"${text.trimEnd()}" is pressable`).toBe('Button')
    }
    await ui.press({ key: 'show-bar-epic' })
    const card = ((await ui.drawn()) as Drawn).children!.find(child => (child as Drawn).props?.position === 'absolute') as Drawn
    expect(card.props?.borderStyle, 'the border is drawn as pressable text').toBeUndefined()
    for (const line of card.children as Drawn[]) {
      expect(textOf(line).length, 'every card row spans the card').toBe(Number(card.props?.width))
      const parts = line.type === 'Button' ? [line] : (line.children as Drawn[])
      for (const part of parts) expect(part.type).toBe('Button')
    }
  })

  snapshotTest('several-rows', 'a press on any dead space hides the card', async (ui, opened) => {
    const deadSpace = [
      'hide-gap-bars',
      'hide-gap-rows',
      'hide-gap-footer',
      `hide-row-${REPO}#3-rest`,
      'hide-bar-epic-rest',
      'hide-source',
      'hide-below-0',
      'hide-below-40',
      'hide-card-bar-epic-beside',
      'hide-card-bar-epic-before',
      'hide-card-bar-epic-top',
      'hide-card-bar-epic-bottom',
    ]
    for (const elsewhere of deadSpace) {
      await ui.press({ key: 'show-bar-epic' })
      expect(await cards(ui)).toHaveLength(1)
      expect(await ui.find({ key: elsewhere }), `${elsewhere} is drawn`).toBeDefined()
      await ui.press({ key: elsewhere })
      expect(await cards(ui), `${elsewhere} hides the card`).toHaveLength(0)
    }
    expect(opened).toEqual([])
  })

  test('several-rows: the space right of a non-item line is part of its press target', { options: { snapshot: 'several-rows' } }, async ($, on) => {
    host(on)
    await run($)
    const ui = await mount($, 'terminal')
    const source = (await ui.find({ key: 'hide-source' })) as Drawn
    expect(textOf(source)).toBe('  Recorded snapshot: several-rows'.padEnd(72))
    expect(textOf(await ui.find({ key: `hide-row-${REPO}#3-rest` }))).toMatch(/^ +$/)
  })

  snapshotTest('several-rows', 'open ↗ is the card\'s first line and opens the GitHub page', async (ui, opened) => {
    for (const key of [`row-${REPO}#3`, `row-${REPO}#4`, 'bar-epic', 'milestone', 'bar-milestone']) {
      expect(await ui.find({ key: `open-${key}` }), `${key} has no button before its card shows`).toBeUndefined()
      await ui.press({ key: `show-${key}` })
      expect((await cardOf(ui, key))[0]).toBe('open ↗')
      await ui.press({ key: `open-${key}` })
    }
    expect(opened).toEqual([
      ['open', `https://github.com/${REPO}/issues/3`],
      ['open', `https://github.com/${REPO}/issues/4`],
      ['open', `https://github.com/${REPO}/issues/2`],
      ['open', `https://github.com/${REPO}/milestone/1`],
      ['open', `https://github.com/${REPO}/milestone/1`],
    ])
  })

  snapshotTest('several-rows', 'items without a page say No page and open nothing', async (ui, opened) => {
    await ui.press({ key: 'show-bar-slate' })
    expect(await ui.find({ key: 'open-bar-slate' })).toBeUndefined()
    expect(await cardOf(ui, 'bar-slate')).toEqual(['No page', 'Slate: derived-read-module-slate', 'Revision: 1', 'Progress: 0/2 closed'])
    await ui.press({ key: 'show-project' })
    expect(await ui.find({ key: 'open-project' })).toBeUndefined()
    expect(await cardOf(ui, 'project')).toEqual(['No page', 'Project: Session Status', 'Scope: Build Session Status initial slices', 'Progress sets shown: Milestone, Epic, Slate'])
    expect(opened).toEqual([])
  })

  snapshotTest('several-rows', 'cards carry the snapshot card data', async ui => {
    await ui.press({ key: `show-row-${REPO}#4` })
    const ticket = (await cardOf(ui, `row-${REPO}#4`)).join('\n')
    expect(ticket).toContain('#4 Add in-progress rows to the read module')
    expect(ticket).toContain('Requested outcome: Not recorded')
    expect(ticket).toContain('Acceptance criteria:')
    await ui.press({ key: 'show-bar-epic' })
    expect(await cardOf(ui, 'bar-epic')).toEqual(['open ↗', 'Epic: Build Session Status initial slices', 'Objective: Not recorded', 'Progress: 0/3 closed', 'Blockers: none'])
    await ui.press({ key: 'show-milestone' })
    expect((await cardOf(ui, 'milestone')).join(' ')).toContain('Progress: 0/4 closed')
  })

  test('several-rows: a long card stays in a short pane and ends with "… N more lines"', { options: { snapshot: 'several-rows' } }, async ($, on) => {
    host(on)
    await run($)
    const ui = await mount($, 'terminal', 40, 14)
    await ui.press({ key: `show-row-${REPO}#3` })
    const card = await cardOf(ui, `row-${REPO}#3`)
    // Row #3 is the window's 12th row: the card takes the 11 rows above it, 9 inside the border.
    expect(card).toHaveLength(9)
    expect(card[0]).toBe('open ↗')
    expect(card[8]).toMatch(/^… \d+ more lines$/)
    for (const line of card) expect(line.length <= 36).toBe(true)
  })
})

describe('section states', () => {
  snapshotTest('hidden-bars', 'hidden sets draw no bar', async ui => {
    for (const kind of ['milestone', 'epic', 'slate']) expect(await ui.find({ key: `show-bar-${kind}` })).toBeUndefined()
    const lines = await lineTexts(ui)
    expect(lines.some(line => /^. (Milestone|Epic|Slate) /.test(line))).toBe(false)
    expect(lines).toContain('  Scope: Read module')
    expect(lines).toContain("  Couldn't load in progress")
  })

  snapshotTest('couldnt-load-scope', 'a failed naming read says Couldn\'t load', async (ui, opened) => {
    const lines = await lineTexts(ui)
    for (const line of ["  Couldn't load project", "  Couldn't load milestone", "  Couldn't load scope", "  Milestone Couldn't load milestone", "  Epic      Couldn't load epic"]) {
      expect(lines).toContain(line)
    }
    expect(lines.filter(line => line.startsWith('▸ Slate'))).toHaveLength(1)
    await ui.press({ key: `show-row-${REPO}#4` })
    await ui.press({ key: `open-row-${REPO}#4` })
    expect(opened).toEqual([['open', `https://github.com/${REPO}/issues/4`]])
  })

  snapshotTest('couldnt-load-epic', 'a partial epic read is Couldn\'t load, never a count', async ui => {
    const lines = await lineTexts(ui)
    expect(lines).toContain("  Epic      Couldn't load epic")
    expect(lines.some(line => /Epic/.test(line) && /\d/.test(line))).toBe(false)
  })

  snapshotTest('couldnt-load-in-progress', 'a failed run-ledger read is Couldn\'t load', async ui => {
    const lines = await lineTexts(ui)
    expect(lines).toContain("  Couldn't load in progress")
    expect(lines.some(line => line.includes('Nothing in progress'))).toBe(false)
  })

  snapshotTest('couldnt-load-card', 'a failed card read keeps the row and has no page', async ui => {
    expect(await lineTexts(ui)).toContain('▸ #4 Add in-progress rows to the read module')
    await ui.press({ key: `show-row-${REPO}#4` })
    expect(await ui.find({ key: `open-row-${REPO}#4` })).toBeUndefined()
    expect(await cardOf(ui, `row-${REPO}#4`)).toEqual(['No page', '#4 Add in-progress rows to the read module', "Couldn't load ticket details"])
  })

  snapshotTest('no-scope', 'No scope yet; slate and rows remain', async ui => {
    const lines = await lineTexts(ui)
    expect(lines).toContain('  No scope yet')
    expect(lines.some(line => /^. (Project|Milestone)/.test(line))).toBe(false)
    expect(lines.filter(line => line.startsWith('▸ Slate'))).toHaveLength(1)
    expect(lines.some(line => /^. Epic/.test(line))).toBe(false)
  })

  snapshotTest('nothing-in-progress', 'empty in-progress section says so', async ui => {
    const lines = await lineTexts(ui)
    expect(lines).toContain('  Nothing in progress')
    expect(lines.some(line => line.startsWith('▸ #'))).toBe(false)
  })

  snapshotTest('empty-sets', 'an empty set says no tickets with no fill', async ui => {
    const lines = await lineTexts(ui)
    expect(lines).toContain('▸ Epic      no tickets')
    expect(lines.some(line => /[█░]/.test(line) && line.includes('Epic'))).toBe(false)
  })

  snapshotTest('no-project', 'Project: Not recorded', async ui => {
    expect(await lineTexts(ui)).toContain('▸ Project: Not recorded')
  })

  snapshotTest('automatic-scope', 'automatic scope is labelled by how it was set', async ui => {
    expect(await lineTexts(ui)).toContain('    from session title (automatic)')
  })

  snapshotTest('cross-repository', 'a row from another repository names it', async ui => {
    expect((await lineTexts(ui)).some(line => /^▸ other-project#\d+ /.test(line))).toBe(true)
  })

  snapshotTest('missing-card', 'missing details say Not recorded', async ui => {
    await ui.press({ key: `show-row-${REPO}#4` })
    const card = await cardOf(ui, `row-${REPO}#4`)
    expect(card[0]).toBe('No page')
    expect(card.join('\n')).toContain('Requested outcome: Not recorded')
    expect(card.join('\n')).toContain('Acceptance criteria: Not recorded')
    expect(card.join('\n')).toContain('Blockers: Not recorded')
  })
})
