import reference from './fixtures/chosen'
import states from './fixtures/chosen-states'
import { paneTree } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import { reportLines } from '../hooks/report-layout'
import { workerLines } from '../hooks/workers'
import { cells, sessionRows } from '../hooks/session-facts'
import { TEMPLATES } from '../hooks/templates'

// Illustrated values retained from the chosen design reference.
const section = { label: 'Project', name: 'session-status', verb: 'achieved', item_kind: 'milestones', description: 'Session Status shows the project, milestone, scope and task progress behind an agent session.', items: [
  { number: 1, title: 'Read module', state: 'done' as const }, { number: 2, title: 'Pane', state: 'done' as const },
  { number: 3, title: 'Initial build', state: 'active' as const }, { number: 4, title: 'Public release', state: 'queued' as const },
] }
const output = (l: any) => (l.prefix ?? '') + (l.marker ?? '') + l.parts.map((p: any) => p.text).join('') + (l.suffix ?? '')
const nodes = (n: any): any[] => !n || typeof n !== 'object' ? [] : [n, ...(n.children ?? []).flatMap(nodes)]
const text = (n: any): string => typeof n === 'string' ? n : (n?.children ?? []).map(text).join('')

describe('chosen design', () => {
  for (const columns of [40, 80]) test(`section states, palette, hatching, expansion and celebration at ${columns}`, () => {
    const lines = reportLines({ scope: 'Build Session Status initial slices', sections: [section] }, columns, [0], undefined, TEMPLATES.github)
    expect(output(lines[1])).toContain('▾ 🎯 Project')
    expect(output(lines[1])).toContain(columns === 40 ? '[2/4]' : '[2/4 achieved]')
    expect(lines[1].accent).toBe('#6ad4a8')
    const bar = lines.find(l => l.key.endsWith('-bar'))!
    expect(output(bar)).toContain('░')
    expect(output(bar)).toContain('·')
    expect(output(bar)).toContain('50%')
    expect(new Set(bar.parts.filter(p => p.text === '█').map(p => p.color)).size > 1).toBe(true)
    expect(bar.parts.find(p => p.text.includes('░'))?.color).toBe('#6ad4a8')
    for (const l of lines.filter(l => l.key.startsWith('section-'))) expect(cells(output(l))).toBe(columns)
    const full = reportLines({ scope: 'Build', sections: [{ ...section, items: section.items.map(i => ({ ...i, state: 'done' as const })) }] }, columns, [], undefined, TEMPLATES.github)
    expect(output(full[1])).toContain('] 🎉')
    expect(full[1].accent).toBe(lines[1].accent)
    expect(full.find(l => l.key.endsWith('-bar'))!.parts[0].color).toBe('#5fbf74')
    const failed = reportLines({ scope: 'Build', sections: [{ ...section, enrichment: { state: 'unavailable', reason: 'GitHub read timed out' } }] }, columns, [], undefined, TEMPLATES.github)
    expect(failed.filter(l => l.key.startsWith('section-')).every(l => l.unavailable && l.parts.every(p => p.dim && p.color === '#808080'))).toBe(true)
    expect(failed.map(output).join('\n')).toContain('┄')
    expect(failed.map(output).join('\n')).not.toContain('50%')
  })
  test('template emoji overrides and all section position colors', () => {
    const palette = ['#6ad4a8', '#5aa9ff', '#b6e05a', '#58c8d8']
    const config = structuredClone(TEMPLATES.github)
    config.sections.project.emoji = '📑'
    const sections = config.section_order.map(k => ({ ...section, label: config.sections[k].label }))
    const rows = reportLines({ scope: 'Build', sections }, 80, [], undefined, config)
    expect(rows.filter(l => l.expand !== undefined).map(l => l.accent)).toEqual(palette)
    expect(rows.map(output).join('\n')).toContain('📑 Project')
  })
  test('every chosen worker status, warning gauge and done dimming', () => {
    for (const columns of [40, 58, 80]) for (const [status, emoji] of Object.entries(TEMPLATES.github.status_emoji)) {
      const rows = workerLines([{ name: 'orchestrator', role: 'main', status, state: status === 'done' ? 'done' : status === 'waiting' ? 'waiting' : status === 'failed' ? 'failed' : 'running', started: 0, changed: 60000, minutes: { 0: 4000 }, total: 128000, context: { tokens: 83000, window: 100000 }, model: 'claude-opus-5-5' }], columns, 60000, true)
      expect(output(rows[0])).toContain('   🤖 Agents')
      expect(rows[0].parts.some(p => p.dim)).toBe(true)
      expect(rows[1].accent).toBe(({ done: '#808080', waiting: '#ececec', failed: '#ff7b86' }[status] ?? '#f2b84b'))
      expect(rows.map(output).join('\n')).toContain(`${emoji} ${status}`)
      expect(rows.some(l => l.parts.some(p => p.color === '#ffcf5a'))).toBe(true)
      for (const l of rows.slice(1)) expect(cells(output(l))).toBe(columns)
      if (status === 'done') expect(rows.slice(1).every(l => l.dim)).toBe(true)
    }
  })
  test('empty space stays text on hover and a pointer click dismisses a card', async ($, on) => {
    mock.clock(on)
    const store = new Map<string, unknown>()
    on('store.get', (_$, e) => ({ value: store.get(e.key) }))
    on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } })
    on('session.id', () => ({ value: 'chosen' }))
    on('session.cwd', () => ({ value: '/tmp' }))
    on('process.run', () => ({ value: { exitCode: 1, stdout: '', stderr: '' } }))
    on('env.get', () => ({ value: undefined }))
    on('fs.exists', () => ({ value: false }))
    on('tool.register', () => ({ value: { tool: 'mcp__whatsup__report' } }))
    on('command.register', (_$, e) => ({ value: { command: e.name } }))
    on('session.start', (_$, e) => ({ cwd: e.cwd }))
    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'mcp__whatsup__report', ...{ scope: 'Build', sections: [section] } })
    const ui = await $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status', props: { title: 'whatsup', bodyColumns: 80, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} }, viewport: { columns: 120, rows: 46, isFullscreen: true } })
    await ui.press({ key: 'show-section-0' })
    expect(nodes(await paneTree(ui)).some(n => n.props?.position === 'absolute')).toBe(true)
    for (const key of ['hide-below-0', 'hide-session-top', 'hide-section-0-rest']) {
      const before = await ui.drawn({ in: key })
      await ui.pointer({ in: key, type: 'move', x: 0, y: 0 })
      expect(await ui.drawn({ in: key })).toEqual(before)
      const tree = await paneTree(ui)
      expect(nodes(tree).some(n => n.type === 'Button' && String(n.props?.key).startsWith('hide-'))).toBe(false)
      await ui.pointer({ in: key, type: 'down', x: 0, y: 0, button: 'left' })
      expect(nodes(await paneTree(ui)).some(n => n.props?.position === 'absolute')).toBe(false)
      await ui.press({ key: 'show-section-0' })
    }
    expect(text(await paneTree(ui))).not.toContain('Recorded snapshot')
  })
})

test('chosen compact session links use three lines at 40 columns', async () => {
  const rows = sessionRows('Build Session Status initial slices', 'f4f55584', { started: 0, folder: '~/Development/session-status', branch: 'main', worktree: 'design-proposals', repository: { name: 'example/project', page: 'https://github.com/example/project' }, pr: { number: 12, page: 'https://github.com/example/project/pull/12', checks: 'passing' } }, { context: {}, rateLimits: [{ kind: 'five_hour', percentUsed: 20 }, { kind: 'seven_day', percentUsed: 43 }] } as any, (13 * 60 + 18) * 60000, 40, 'compact')
  expect(rows.map(r => r.parts.map(p => p.text).join(''))).toEqual([
    'Build Session Status initial slices', '13h18m · 5h 20% · wk 43%',
    '🌿 main · 🌳 design-proposals', '🔗 repo', '📁 folder ⧉ · f4f55584 ⧉ · PR:#12 ✓',
  ])
})

// The expected bar cells come from the design renderer, independently of the pane.
for (const fixture of reference.cases) test(`chosen still: ${fixture.still}`, () => {
  compareChosenState(fixture.still, fixture.columns)
  if (fixture.agents_only) return
  const report = reference.reports[fixture.mode as keyof typeof reference.reports]
  const rows = reportLines(report as any, fixture.columns, fixture.expanded)
  const headers = rows.filter(l => l.expand !== undefined)
  headers.forEach((line, index) => {
    const expected = fixture.headers[index]
    const actual = output(line)
    const label = report.sections[index].label
    // Could-not-load removes the decorative section emoji to keep that box neutral.
    if (!line.unavailable) expect(Math.abs(cells(actual.slice(0, actual.indexOf(label))) - cells(expected.slice(0, expected.indexOf(label)))) <= 1).toBe(true)
    if (line.badge && !line.unavailable) {
      expect(expected).toContain(line.badge)
      expect(Math.abs(cells(actual.slice(0, actual.indexOf(line.badge))) - cells(expected.slice(0, expected.indexOf(line.badge)))) <= 1).toBe(true)
    }
  })
  const bars = rows.filter(l => l.key.endsWith('-bar')).map(output)
  expect(bars.length).toBe(fixture.bars.length)
  bars.forEach((bar, index) => {
    const expected = fixture.bars[index]
    // Python's design renderer and JS round half cells differently at 58 columns.
    for (const glyph of ['█', '░', '·']) expect(Math.abs([...bar].filter(c => c === glyph).length - [...expected].filter(c => c === glyph).length) <= 1).toBe(true)
    expect(bar.slice(-8)).toBe(expected.slice(-8))
  })
  for (const row of rows.filter(l => l.key.startsWith('section-'))) expect(cells(output(row))).toBe(fixture.columns)
  for (const index of fixture.expanded) {
    expect(rows.some(l => l.key === `section-${index}-kind`)).toBe(true)
    if ('description' in report.sections[index]) expect(rows.some(l => l.key === `section-${index}-description`)).toBe(true)
  }
})

test('chosen full-density session keeps usage and relative resets on the wide usage row', () => {
  const now = 798 * 60000
  const rows = sessionRows('Build Session Status initial slices', 'f4f55584', { started: 0, folder: '~/Development/session-status' }, { context: { tokens: 437000, window: 1000000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 20, resetsAt: new Date(now + 131 * 60000).toISOString() },
    { kind: 'seven_day', percentUsed: 43, resetsAt: new Date(now + (5 * 24 + 17) * 3600000).toISOString() },
  ] } as any, now, 80, 'full')
  expect(rows[1].parts.map(p => p.text).join('')).toBe('13h 18m · 5h 20% · reset 2h 11m · weekly 43% · reset 5d 17h')
  expect(rows.filter(r => r.key.startsWith('reset-')).length).toBe(0)
})

// Compare the defining worker and session content, not just unrelated section bars.
// The source stills predate the approved status-below-graph and numeric-context layout.
function compareChosenState(still: string, columns: number) {
  const source = states[still as keyof typeof states]
  const now = 798 * 60000
  const workers = source.agents.map((a: any) => ({
    name: a.name, role: a.role, model: a.model, status: a.status,
    state: ['done', 'failed', 'waiting'].includes(a.status) ? a.status : 'running',
    started: 0, changed: now, task: { title: a.task.title, number: a.task.num ? Number(a.task.num.slice(1)) : undefined },
    total: a.tokens == null ? undefined : Number(a.tokens.replace('k', '')) * 1000,
    context: { tokens: a.ctx * 1000, window: 100000 },
    // Use the illustrated heights as proportional token counts.
    minutes: Object.fromEntries([...(a.spark_text ?? '')].map((c, i) => [798 - [...a.spark_text].length + 1 + i, ('▁▂▃▄▅▆▇█'.indexOf(c) + 1) * 1000])),
  }))
  const rows = workerLines(workers, columns, now, true)
  expect(output(rows[0])).toContain(`🤖 Agents · ${workers.filter(w => w.state === 'running').length} running`)
  workers.forEach((worker, i) => {
    const a = source.agents[i]
    const palette = { running: ['#f2b84b', '#302a1a'], waiting: ['#ececec', undefined], failed: ['#ff7b86', '#33222a'], done: ['#808080', undefined] }
    const [accent, tint] = palette[worker.state as keyof typeof palette]
    const done = a.status === 'done'
    const box = rows.filter(r => r.key === `worker-${i}` || r.key.startsWith(`worker-${i}-`))
    expect(box.length).toBe(7)
    for (const row of box) {
      expect(cells(output(row))).toBe(columns)
      expect(row.accent).toBe(done ? '#808080' : accent)
      expect(row.dim).toBe(done)
    }
    expect(box[0].parts[0].color).toBe(done ? '#808080' : accent)
    expect(box[0].badge).toBe(columns < 56 ? a.model.replace('claude-', '') : a.model)
    expect(output(box[0])).toContain(worker.role)
    expect(box[1].background).toBe(done ? undefined : tint)
    expect(output(box[5])).toContain(`${TEMPLATES.github.status_emoji[a.status]} ${a.status}`)
    expect(box[5].parts[0].color).toBe(done ? '#808080' : accent)
    expect(box[5].parts[1].color).toBe(a.ctx > 80 ? '#ffcf5a' : done ? '#808080' : accent)
    expect(output(box[5])).toContain(`${a.ctx}%`)
    if (a.tokens != null) expect(output(box[3])).toContain(`${a.tokens} tokens`)
    else expect(output(box[3])).not.toContain('tokens')
    if ('spark_text' in a) {
      const available = columns - 4 - 13
      // The stills predate relative scaling: normalize their visible heights.
      const glyphs = ' ▁▂▃▄▅▆▇█'
      const levels = [...a.spark_text.slice(-available)].map(c => glyphs.indexOf(c))
      const peak = Math.max(0, ...levels)
      const expected = levels.map(level => glyphs[peak ? Math.ceil(8 * level / peak) : 0]).join('')
      expect(box[3].parts[0].text.trimStart().startsWith(expected)).toBe(true)
    }
  })
  if (still.startsWith('activity-reduced')) {
    expect(workerLines(workers, columns, now + 60000, true).filter(r => r.key.endsWith('-graph')))
      .toEqual(rows.filter(r => r.key.endsWith('-graph')))
  }
  if (source.agents_only) return
  const s = source.session, full = still.startsWith('session-full')
  const session = sessionRows('Build Session Status initial slices', s.id, {
    started: 0, folder: s.cwd, branch: s.branch, worktree: s.worktree,
    repository: { name: s.repo, page: `https://github.com/${s.repo}` },
    pr: { number: s.pr, page: `https://github.com/${s.repo}/pull/${s.pr}`, checks: 'passing' },
  }, { context: { tokens: 437000, window: 1000000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: s.h5, resetsAt: new Date(now + 131 * 60000).toISOString() },
    { kind: 'seven_day', percentUsed: s.wk, resetsAt: new Date(now + 137 * 3600000).toISOString() },
  ] } as any, now, columns, full ? 'full' : 'compact')
  const rendered = session.map(r => r.parts.map(p => p.text).join(''))
  expect(rendered[0]).toBe('Build Session Status initial slices')
  expect(rendered[1]).toBe(full && columns >= 56
    ? '13h 18m · 5h 20% · reset 2h 11m · weekly 43% · reset 5d 17h'
    : `${columns < 56 ? '13h18m' : s.age} · 5h 20% · wk 43%`)
  for (const row of rendered) expect(cells(row) <= columns - 4).toBe(true)
  const links = session.filter(r => r.key.startsWith('links-'))
  expect(links.every(r => r.dim)).toBe(true)
  expect(links.flatMap(r => r.parts).filter(p => p.action).map(p => p.action))
    .toEqual(['open-repository', 'open-folder', 'copy-folder', 'copy-id', 'open-pr'])
  expect(rendered.join('\n')).toContain(`PR:#${s.pr} ✓`)
  expect(session.some(r => r.key === 'context')).toBe(full)
  if (full) {
    expect(rendered).toContain('Context 437,000/1,000,000')
    if (columns < 56) {
      expect(rendered).toContain('5h resets 2h 11m')
      expect(rendered).toContain('week resets 5d 17h')
    }
  }
}

for (const columns of [40, 58, 80]) test(`worker execution transitions change state colors at ${columns}`, () => {
  const sample = states['agents-states-80.png'].agents
  for (const a of [...sample, ...states['agents-status-a-80.png'].agents]) {
    const palette = { running: '#f2b84b', waiting: '#ececec', failed: '#ff7b86', done: '#808080' }
    // A free-text status does not own execution state or completion styling.
    for (const state of ['running', 'failed', 'running', 'waiting', 'done'] as const) {
      const worker = { name: a.name, role: a.role, model: a.model, status: 'reviewing', state,
        started: 0, changed: 60000, minutes: { 0: 4000, 1: 3000 }, inFlight: true }
      const first = workerLines([worker], columns, 60000, false)
      const later = workerLines([worker], columns, 120000, false)
      expect(first[1].accent).toBe(palette[state])
      expect(first[1].dim).toBe(state === 'done')
      expect(first[2].background === undefined).toBe(state === 'done' || state === 'waiting')
      expect(first.find(r => r.key === 'worker-0-status')!.parts[0].color).toBe(palette[state])
      if (state === 'failed' || state === 'done') {
        expect(output(later.find(r => r.key === 'worker-0-task'))).toBe(output(first.find(r => r.key === 'worker-0-task'))) // elapsed time freezes
        expect(output(later.find(r => r.key === 'worker-0-graph'))).toBe(output(first.find(r => r.key === 'worker-0-graph'))) // terminal graph freezes
      }
      if (state === 'waiting') expect(output(later.find(r => r.key === 'worker-0-graph'))).toBe(output(first.find(r => r.key === 'worker-0-graph')))
    }
  }
})


test('a full report with every worker state contains no shipped pastel colors', () => {
  const source = states['agents-states-80.png'].agents[0]
  const workers = (['running', 'waiting', 'failed', 'done'] as const).map(state => ({
    name: source.name, role: source.role, model: source.model, status: source.status, state,
    started: 0, changed: 60000, minutes: { 0: 4000 },
  }))
  const lines = [...reportLines({ scope: 'Build', sections: [section] }, 80, [0]), ...workerLines(workers, 80, 60000, true)]
  expect(JSON.stringify(lines)).not.toMatch(/#(?:ffab91|f2c79b|c9a7ff|8ecbff|ff9ecb|7fe0c8|a8b4ff|9fe3f0)/i)
})
