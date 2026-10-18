import { paneTree } from './pane-tree'
import { describe, expect, test, mock } from 'claude-code/testing'
import type { On } from 'claude-code'

function host(on: On, user?: unknown, repo?: unknown, root = '/project') {
  mock.clock(on)
  const store = new Map<string, unknown>(), panes: string[] = [], commands: string[] = [], reads: string[] = []
  on('env.get', () => ({ value: '/home/user' }))
  on('fs.exists', (_$, e) => ({ value: e.path === `${root}/.git` || (e.path === '/project/.whatsup.json' && repo !== undefined) || (e.path === '/home/user/.config/whatsup/config.json' && user !== undefined) }))
  on('fs.read', (_$, e) => { reads.push(e.path); return { value: JSON.stringify(e.path.startsWith('/project/') ? repo : user) } })
  on('store.get', (_$, e) => ({ value: store.get(e.key) }))
  on('store.set', (_$, e) => { store.set(e.key, e.value); return { value: undefined } })
  on('session.cwd', () => ({ value: '/tmp' }))
  on('session.id', () => ({ value: 'config-session' }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('tool.register', () => ({ value: { tool: 'mcp__whatsup__report' } }))
  on('command.register', (_$, e) => { commands.push(e.name); return { value: { command: e.name } } })
  on('ui.open', (_$, e) => { panes.push(e.id); return { value: { isPlaced: true } } })
  on('prompt.context', (_$, e) => ({ blocks: e.blocks }))
  return { store, panes, commands, reads }
}
describe('startup configuration', () => {
  test('startup refreshes context cached before configuration is ready', async ($, on) => {
    host(on)
    // Core 2.1.302 computes these blocks and instructionFiles before session.start
    // finishes. Neutralized instruction content; retain the live event structure.
    const event = {
      blocks: [
        { name: 'claudeMd', text: 'Project instructions' },
        { name: 'userEmail', text: 'User identity' },
        { name: 'currentDate', text: "Today's date is 2026-10-18." },
      ],
      instructionFiles: [{ path: '/project/CLAUDE.md', kind: 'project' as const, content: 'Project instructions' }],
    }
    let cached: Awaited<ReturnType<typeof $.prompt.context>> | undefined
    on('ui.invalidate', (_$, e) => {
      if (e.event === 'prompt.context') cached = undefined
      return { value: undefined }
    })
    const context = async () => cached ??= await $.prompt.context(event)
    expect((await context()).blocks.find(b => b.name === 'whatsup')).toBeUndefined()
    await $.session.start({ cwd: '/project/src', surface: 'terminal', isInteractive: true })
    const refreshed = await context()
    expect(refreshed.blocks.find(b => b.name === 'whatsup')?.text).toContain('"label":"Project","verb":"achieved","item_kind":"milestones"')
    expect(refreshed.blocks.slice(0, event.blocks.length)).toEqual(event.blocks)
    expect(refreshed.instructionFiles).toEqual(event.instructionFiles)
  })
  for (const [name, user, repo, label] of [
    ['neither', undefined, undefined, 'Project'], ['user', { template: 'bare' }, undefined, 'Queue'],
    ['repository', undefined, { template: 'task-list' }, 'Queue'],
    ['both', { template: 'bare', session: { density: 'full' } }, { template: 'github', sections: { epic: { label: 'Delivery' } } }, 'Delivery'],
  ] as const) test(`loads ${name} files from a nested working directory`, async ($, on) => {
    const h = host(on, user, repo)
    await $.session.start({ cwd: '/project/src', surface: 'terminal', isInteractive: true })
    const context = await $.prompt.context({ blocks: [{ name: 'existing', text: 'Keep' }] })
    expect(context.blocks[0]!.text).toBe('Keep')
    expect(context.blocks.find(b => b.name === 'whatsup')?.text).toContain(label)
    expect(h.panes).toHaveLength(0)
    expect(h.commands).toContain('whatsup')
    expect(h.store.get('template-config:config-session')).toBeDefined()
    await $.command.run({ command: 'whatsup', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } })
    expect(h.panes).toEqual(['session-status'])
  })
  test('outside git reads configuration from the starting directory', async ($, on) => {
    const h = host(on, undefined, { template: 'bare' }, '/absent')
    await $.session.start({ cwd: '/project', surface: null, isInteractive: false })
    expect(h.reads).toEqual(['/project/.whatsup.json'])
  })
  test('configured expansion reaches the rendered pane and reporting never opens it', async ($, on) => {
    const h = host(on, undefined, { sections: { queue: { collapsed: false } } })
    await $.session.start({ cwd: '/project', surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'mcp__whatsup__report', ...{ scope: 'Templates', sections: [{ label: 'Queue', verb: 'finished', item_kind: 'tasks', items: [{ title: 'Read the brief', state: 'done' }] }] } })
    const ui = await $.ui.mount({ plugin: 'whatsup', surface: 'terminal', component: 'Pane', requestId: 'session-status',
      props: { title: 'whatsup', bodyColumns: 80, isFocused: false, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
      viewport: { columns: 120, rows: 46, isFullscreen: true } })
    expect(JSON.stringify(await paneTree(ui))).toContain('Read the brief')
    expect(h.panes).toHaveLength(0)
  })
  test('disabled instruction contributes no model context', async ($, on) => {
    host(on, undefined, { instruction: false })
    await $.session.start({ cwd: '/project', surface: null, isInteractive: false })
    expect((await $.prompt.context({ blocks: [] })).blocks).toEqual([])
  })
})
