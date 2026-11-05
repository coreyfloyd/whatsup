import { paneTree } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import { cells, sessionRows } from '../hooks/session-facts'
import type { On } from 'claude-code'

const folder = '/project/.worktrees/session-box'
function host(on: On, density: string | undefined, worktree: boolean, pr: boolean, conclusion = 'SUCCESS') {
  const clock = mock.clock(on)
  const store = new Map<string, unknown>(), commands: { argv: string[]; stdin?: string }[] = []
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('session.id', () => ({ value: 'report-session' }))
  on('session.cwd', () => ({ value: folder }))
  on('session.repo', () => ({ value: { root: '/project', remote: 'git@github.com:example/project.git', internal: false, name: null } }))
  on('session.usage', () => ({ value: { context: { tokens: 32000, window: 200000 }, rateLimits: [
    { kind: 'five_hour', percentUsed: 23.5, resetsAt: '2026-10-17T18:00:00Z' },
    { kind: 'seven_day', percentUsed: 7, resetsAt: '2026-10-20T18:00:00Z' },
  ] } }))
  on('env.get', () => ({ value: undefined }))
  on('fs.exists', (_$, e) => ({ value: e.path === `${folder}/.git` || (density !== undefined && e.path === `${folder}/.whatsup.json`) }))
  on('fs.read', () => ({ value: JSON.stringify({ session: { density } }) }))
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: { tool: 'mcp__whatsup__report' } }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('process.run', (_$, e) => {
    commands.push({ argv: [...e.argv], stdin: e.init?.stdin })
    const stdout = e.argv[0] === 'git' ? `epic-9/12-session-box\n${folder}\n${worktree ? '/project/.git/worktrees/session-box' : '/project/.git'}\n/project/.git\n`
      : e.argv[0] === 'gh' && pr ? JSON.stringify({ number: 12, url: 'https://github.com/example/project/pull/12', statusCheckRollup: [{ status: 'COMPLETED', conclusion }] }) : ''
    return { value: { exitCode: e.argv[0] === 'gh' && !pr ? 1 : 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  return { commands, clock }
}
type Node = { props?: Record<string, any>; children?: unknown[] }
function text(n: any): string { return typeof n === 'string' ? n : (n?.children ?? []).map(text).join('') }
function nodes(n: any): Node[] { return !n || typeof n !== 'object' ? [] : [n, ...(n.children ?? []).flatMap(nodes)] }

describe('live session box', () => {
  const scopeLines = (scope: string, columns: number, density: 'compact' | 'full' = 'compact') =>
    sessionRows(scope, 'report-session', { started: 0, folder }, undefined, 0, columns, density)
      .filter(row => /^scope(-\d+)?$/.test(row.key)).map(row => row.parts.map(part => part.text).join(''))
  const sketch = 'Plan and ship the review page kit color restore, then deploy the new planning release to every machine'
  const overflow = sketch + ', then retire the old pane and publish the release notes for every team'
  test('scope wraps on word boundaries across one, two and three rows at narrow and wide widths', () => {
    expect(scopeLines('Fill the session box', 40)).toEqual(['Fill the session box'])
    expect(scopeLines('Fill the session box', 80)).toEqual(['Fill the session box'])
    expect(scopeLines('Plan and ship the review page kit color restore', 40)).toEqual(['Plan and ship the review page kit', 'color restore'])
    expect(scopeLines('Plan and ship the review page kit color restore', 80)).toEqual(['Plan and ship the review page kit color restore'])
    expect(scopeLines(sketch, 44)).toEqual(['Plan and ship the review page kit color', 'restore, then deploy the new planning', 'release to every machine'])
    expect(scopeLines(sketch, 40)).toEqual(['Plan and ship the review page kit', 'color restore, then deploy the new', 'planning release to every machine'])
    expect(scopeLines(sketch, 80)).toEqual(['Plan and ship the review page kit color restore, then deploy the new', 'planning release to every machine'])
    const keys = sessionRows(sketch, 'report-session', { started: 0, folder }, undefined, 0, 40, 'compact').map(row => row.key)
    expect(keys.slice(0, 4)).toEqual(['scope', 'scope-1', 'scope-2', 'usage'])
  })
  test('only scope remaining after the third row ends that row with an ellipsis', () => {
    expect(scopeLines(overflow, 40)).toEqual(['Plan and ship the review page kit', 'color restore, then deploy the new', 'planning release to every machine,…'])
    expect(scopeLines(overflow, 80)).toEqual(['Plan and ship the review page kit color restore, then deploy the new', 'planning release to every machine, then retire the old pane and publish the', 'release notes for every team'])
    const wide = scopeLines(overflow + ' and close the epic after the final deploy is verified on each machine', 80)
    expect(wide.length).toBe(3)
    expect(wide[2]!.endsWith('…')).toBe(true)
    expect(cells(wide[2]!)).toBeLessThan(77)
    // A full third row gives up its last cell to the ellipsis.
    expect(scopeLines('aaaa bbbb cccc dddd', 8)).toEqual(['aaaa', 'bbbb', 'ccc…'])
  })
  test('emoji take two cells and a word wider than the box hard-breaks', () => {
    expect(scopeLines('🚀 Ship the release', 14)).toEqual(['🚀 Ship', 'the', 'release'])
    expect(scopeLines('🚀 Ship the release 🎉 now', 14)).toEqual(['🚀 Ship', 'the', 'release…'])
    expect(scopeLines('🚀 Ship the release 🎉 now', 80)).toEqual(['🚀 Ship the release 🎉 now'])
    expect(scopeLines('Supercalifragilistic word', 14)).toEqual(['Supercalif', 'ragilistic', 'word'])
  })
  test('every scope row fits the box at every width and keeps the scope text in order', () => {
    for (const scope of [overflow, '🚀 ' + sketch + ' 🎉', 'line\nbreaks\tand tabs']) for (const density of ['compact', 'full'] as const) for (let columns = 6; columns <= 120; columns++) {
      const lines = scopeLines(scope, columns, density)
      expect(lines.length >= 1 && lines.length <= 3).toBe(true)
      for (const line of lines) expect(cells(line) <= columns - 4).toBe(true)
      const words = scope.split(/\s+/).join('')
      const shown = lines.join('').replace(/…$/, '')
      expect(words.startsWith(shown.replace(/\s+/g, ''))).toBe(true)
      expect(lines[lines.length - 1]!.endsWith('…')).toBe(shown.replace(/\s+/g, '') !== words)
    }
  })

  for (const density of ['compact', 'full']) for (const columns of [40, 80]) for (const worktree of [false, true]) for (const pr of [false, true]) {
    test(`${density} ${columns} columns worktree=${worktree} PR=${pr}`, async ($, on) => {
      const h = host(on, density, worktree, pr, columns === 40 ? 'FAILURE' : 'SUCCESS')
      await $.session.start({ cwd: folder, surface: 'terminal', isInteractive: true })
      await $.tool.call({ tool: 'mcp__whatsup__report', ...{ scope: 'Fill the session box' } })
      const ui = await $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status',
        props: { title: 'whatsup', bodyColumns: columns, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
        viewport: { columns: columns + 40, rows: 46, isFullscreen: true } })
      await h.clock.advance(65 * 60000)
      await $.session.measure({ context: { tokens: 32000, window: 200000 }, rateLimits: [], changed: ['context'] })
      const tree = await paneTree(ui), output = text(tree)
      expect(output).toContain(columns < 56 ? '1h5m' : '1h 5m')
      expect(output).toContain('Session')
      expect(output).toContain('Fill the session box')
      const scopeRow = nodes(tree).find(n => n.props?.key === 'session-row-scope')!
      expect(text(scopeRow).slice(2, -2).trim()).toBe('Fill the session box')
      expect(output).toContain('5h 23.5%')
      expect(output).toContain(density === 'full' && columns >= 56 ? 'weekly 7%' : 'wk 7%')
      expect(output).toContain('🌿')
      expect(output.includes('🌳')).toBe(worktree)
      expect(output.includes('PR:#12')).toBe(pr)
      if (pr) expect(output).toContain(columns === 40 ? '✗' : '✓')
      expect(cells(text(nodes(tree).find(n => n.props?.key === 'hide-session-top')))).toBe(columns)
      expect(text(nodes(tree).find(n => n.props?.key === 'hide-session-top'))).toBe('┌─ Session ' + '─'.repeat(columns - 12) + '┐')
      expect(output.includes('32,000/200,000')).toBe(density === 'full')
      expect(output.includes('reset')).toBe(density === 'full')
      const rows = nodes(tree).filter(n => String(n.props?.key ?? '').startsWith('session-row-'))
      expect(rows.length).toBeGreaterThan(0)
      for (const row of rows) expect(cells(text(row)) <= columns).toBe(true)
      expect(nodes(tree).some(n => n.props?.color === '#9fd3e8' && text(n) === 'PR:#12')).toBe(pr)
      await ui.press({ key: 'session-open-repository' })
      await ui.press({ key: 'session-open-folder' })
      await ui.press({ key: 'session-copy-folder' })
      await ui.press({ key: 'session-copy-id' })
      if (pr) await ui.press({ key: 'session-open-pr' })
      expect(h.commands).toContainEqual({ argv: ['open', '--', 'https://github.com/example/project'], stdin: undefined })
      expect(h.commands).toContainEqual({ argv: ['open', '--', folder], stdin: undefined })
      expect(h.commands).toContainEqual({ argv: ['pbcopy'], stdin: folder })
      expect(h.commands).toContainEqual({ argv: ['pbcopy'], stdin: 'report-session' })
      if (pr) expect(h.commands).toContainEqual({ argv: ['open', '--', 'https://github.com/example/project/pull/12'], stdin: undefined })
    })
  }
  test('unknown measurements stay unknown and failed or pending checks keep their status', () => {
    for (const checks of ['passing', 'failing', 'pending'] as const) {
      const rows = sessionRows('Fill the session box', 'report-session', {
        started: 0, folder, pr: { number: 12, page: 'https://github.com/example/project/pull/12', checks },
      }, undefined, 60000, 40, 'full')
      const output = rows.map(row => row.parts.map(part => part.text).join('')).join('\n')
      expect(output).toContain('1m · 5h — · wk —')
      expect(output).toContain('Context —/—')
      expect(output).toContain(checks === 'passing' ? '✓' : checks === 'failing' ? '✗' : '…')
      expect(output).not.toContain('0%')
    }
  })
  test('long Unicode references wrap without losing text or action destinations', () => {
    const path = folder + '/文'.repeat(30)
    const rows = sessionRows('Fill the session box', 'report-session', { started: 0, folder: path }, undefined, 0, 80, 'compact')
    const links = rows.filter(row => row.key.startsWith('links'))
    expect(links.flatMap(row => row.parts).filter(part => part.action === 'open-folder').map(part => part.text).join('')).toBe('📁 ' + path)
    for (const row of links) {
      expect(cells(row.parts.map(part => part.text).join('')) <= 76).toBe(true)
      for (const part of row.parts.filter(part => part.action === 'open-folder')) expect(part.target).toBe(path)
    }
  })

  test('the terminal box draws a wrapped scope as bordered rows in order', async ($, on) => {
    host(on, undefined, false, false)
    await $.session.start({ cwd: folder, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'mcp__whatsup__report', ...{ scope: sketch } })
    const ui = await $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status',
      props: { title: 'whatsup', bodyColumns: 44, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
      viewport: { columns: 84, rows: 46, isFullscreen: true } })
    const tree = await paneTree(ui)
    const drawn = ['scope', 'scope-1', 'scope-2'].map(key => nodes(tree).find(n => n.props?.key === `session-row-${key}`)!)
    expect(drawn.map(row => text(row).slice(2, -2).trim())).toEqual(['Plan and ship the review page kit color', 'restore, then deploy the new planning', 'release to every machine'])
    for (const row of drawn) expect(cells(text(row))).toBe(44)
  })

  test('no report still draws the session box and default compact density', async ($, on) => {
    host(on, undefined, false, false)
    await $.session.start({ cwd: folder, surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status',
      props: { title: 'whatsup', bodyColumns: 80, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
      viewport: { columns: 120, rows: 46, isFullscreen: true } })
    const output = text(await paneTree(ui))
    expect(output).toContain('Session')
    expect(output).toContain('No scope yet')
    expect(output).toContain('Waiting for the agent’s first report')
    expect(output).not.toContain('Context')
    expect(output).not.toContain('resets')
  })

  test('unusable pane widths produce no content rows', () => {
    for (const columns of [NaN, 0, 1, 5]) expect(sessionRows('Fill the session box', 'report-session', { started: 0, folder }, undefined, 0, columns, 'compact')).toEqual([])
  })

})
