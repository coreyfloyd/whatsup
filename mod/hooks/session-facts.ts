import type { CoreEngineInterface, On, SessionUsage, Timer } from 'claude-code'

export type SessionFacts = {
  started: number; folder: string; branch?: string; worktree?: string;
  repository?: { name: string; page: string };
  pr?: { number: number; page: string; checks: 'passing' | 'failing' | 'pending' };
}
export const factsKey = (session: string) => `session-facts:${session}`

export async function readSessionEnvironment($: CoreEngineInterface, session: string, folder: string) {
  const previous = await $.store.get(factsKey(session)) as SessionFacts | undefined
  const facts: SessionFacts = { started: previous?.started ?? await $.clock.now(), folder }
  try {
    const repo = await $.session.repo()
    const match = repo?.remote?.match(/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)([^/\s]+\/[^/\s]+?)?(?:\.git)?\/?$/)
    if (match?.[1]) facts.repository = { name: match[1], page: `https://github.com/${match[1]}` }
    const git = await $.process.run(['git', 'rev-parse', '--abbrev-ref', 'HEAD', '--show-toplevel', '--absolute-git-dir', '--path-format=absolute', '--git-common-dir'], { cwd: folder, timeoutMs: 5000 })
    if (git.exitCode === 0 && !git.isStdoutTruncated) {
      const [branch, root, directory, common] = git.stdout.trim().split('\n')
      if (branch && branch !== 'HEAD') facts.branch = branch
      if (root && directory && common && directory !== common) facts.worktree = root.split('/').pop()
    }
    if (facts.repository && facts.branch) {
      const result = await $.process.run(['gh', 'pr', 'view', facts.branch, '--repo', facts.repository.name, '--json', 'number,url,statusCheckRollup'], { cwd: folder, timeoutMs: 5000 })
      if (result.exitCode === 0 && !result.isStdoutTruncated) {
        const pr = JSON.parse(result.stdout)
        if (Number.isInteger(pr.number) && pr.number > 0 && pr.url === `${facts.repository.page}/pull/${pr.number}`) {
          const checks = Array.isArray(pr.statusCheckRollup) ? pr.statusCheckRollup : []
          const failed = checks.some((check: any) => ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(check.conclusion ?? check.state))
          const passed = checks.length > 0 && checks.every((check: any) => ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(check.conclusion ?? check.state))
          facts.pr = { number: pr.number, page: pr.url, checks: failed ? 'failing' : passed ? 'passing' : 'pending' }
        }
      }
    }
  } catch { /* Missing git/GitHub facts stay absent, never fabricated. */ }
  await $.store.set(factsKey(session), facts)
}

export function registerSessionFacts(on: On, recorded: boolean) {
  if (recorded) return
  const timers = new Map<string, Timer>()
  on('session.measure', async ($, e, next) => { $.ui.invalidate('ui.render'); return next(e) })
  on('ui.open', { id: 'session-status' }, async ($, e, next) => {
    if (e.id === 'session-status') {
      const session = await $.session.id()
      await readSessionEnvironment($, session, await $.session.cwd())
      timers.get(session)?.cancel()
      timers.set(session, $.clock.every(60000, () => { $.ui.invalidate('ui.render') }))
    }
    return next(e)
  })
  on('ui.close', { id: 'session-status' }, async ($, e, next) => {
    if (e.id === 'session-status') {
      const session = await $.session.id()
      timers.get(session)?.cancel(); timers.delete(session)
    }
    return next(e)
  })
}

export type SessionPart = { text: string; action?: string; target?: string; accent?: boolean }
export type SessionRow = { key: string; parts: SessionPart[]; dim?: boolean }
// Emoji presentation and wide characters use two cells; text symbols such as ↗ use one.
export function cells(text: string): number {
  const characters = [...text]
  return characters.reduce((n, c, index) => n + (/[\p{Mark}\uFE0F\u200D]/u.test(c) ? 0
    : /[\p{Emoji_Presentation}\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFF01-\uFF60]/u.test(c)
      || (characters[index + 1] === '\uFE0F' && /\p{Extended_Pictographic}/u.test(c)) ? 2 : 1), 0)
}
export function fit(text: string, width: number) {
  let result = ''
  for (const c of text.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')) {
    if (cells(result + c) > width) break
    result += c
  }
  return result
}
export function sessionRows(scope: string, id: string, facts: SessionFacts, usage: SessionUsage | undefined, now: number, columns: number, density: 'compact' | 'full', offReason?: string | null): SessionRow[] {
  if (!Number.isFinite(columns) || columns < 6) return []
  const width = columns - 4, rows: SessionRow[] = []
  const add = (key: string, text: string, dim = false) => rows.push({ key, parts: [{ text: fit(text, width) }], dim })
  const minutes = Math.max(0, Math.floor((now - facts.started) / 60000))
  const elapsed = minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  const five = usage?.rateLimits.find(r => r.kind === 'five_hour'), week = usage?.rateLimits.find(r => r.kind === 'seven_day')
  const fittedScope = fit(scope, width)
  add('scope', fittedScope.length < scope.length ? fit(scope, width - 1) + '…' : fittedScope)
  const wide = columns >= 56
  const reset = (at: string | undefined) => {
    if (!at || !Number.isFinite(Date.parse(at))) return '—'
    const minutes = Math.max(0, Math.ceil((Date.parse(at) - now) / 60000))
    return minutes >= 1440 ? `${Math.floor(minutes / 1440)}d ${Math.floor(minutes % 1440 / 60)}h` : minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`
  }
  const usageLine = density === 'full' && wide
    ? `${elapsed} · 5h ${five ? five.percentUsed + '%' : '—'} · reset ${reset(five?.resetsAt)} · weekly ${week ? week.percentUsed + '%' : '—'} · reset ${reset(week?.resetsAt)}`
    : `${wide ? elapsed : elapsed.replace(' ', '')} · 5h ${five ? five.percentUsed + '%' : '—'} · wk ${week ? week.percentUsed + '%' : '—'}`
  add('usage', usageLine)
  const where: SessionPart[][] = [
    ...(facts.branch ? [[{ text: `🌿 ${facts.branch}` }]] : []),
    ...(facts.worktree ? [[{ text: `🌳 ${facts.worktree}` }]] : []),
  ]
  const repo: SessionPart[][] = facts.repository ? [[{ text: `🔗 ${wide ? facts.repository.name : 'repo'}`, action: 'open-repository', target: facts.repository.page }]] : []
  const links: SessionPart[][] = [
    [{ text: `📁 ${wide ? facts.folder : 'folder'}`, action: 'open-folder', target: facts.folder }, { text: ' ' }, { text: '⧉', action: 'copy-folder', target: facts.folder, accent: true }],
    [{ text: id }, { text: ' ' }, { text: '⧉', action: 'copy-id', target: id, accent: true }],
    ...(facts.pr ? [[{ text: `PR:#${facts.pr.number}`, action: 'open-pr', target: facts.pr.page, accent: true }, { text: ' ' + (facts.pr.checks === 'passing' ? '✓' : facts.pr.checks === 'failing' ? '✗' : '…') }]] : []),
  ]
  const groupWidth = (groups: SessionPart[][]) => groups.flat().reduce((n, p) => n + cells(p.text), 0) + Math.max(0, groups.length - 1) * 3
  const referenceLines = wide && density === 'compact' && groupWidth([...where, ...repo]) <= width ? [[...where, ...repo], links] : [where, repo, links]
  // Wrap complete references when possible; long ids and paths retain their action targets.
  for (const groups of referenceLines) {
    let parts: SessionPart[] = [], used = 0
    const flush = () => { if (parts.length) rows.push({ key: `links-${rows.length}`, parts, dim: true }); parts = []; used = 0 }
    for (const group of groups) {
      if (used && used + 3 + groupWidth([group]) > width) flush()
      if (used) { parts.push({ text: ' · ' }); used += 3 }
      for (const part of group) {
        let remaining = part.text.replace(/[\r\n\t\x00-\x1f\x7f]/g, ' ')
        while (remaining) {
          const piece = fit(remaining, width - used)
          if (!piece) { flush(); continue }
          parts.push({ ...part, text: piece }); used += cells(piece); remaining = remaining.slice(piece.length)
          if (remaining) flush()
        }
      }
    }
    flush()
  }
  if (density === 'full') {
    if (!wide) for (const [label, limit] of [['5h', five], ['week', week]] as const) if (limit?.resetsAt) add(`reset-${label}`, `${label} resets ${reset(limit.resetsAt)}`, true)
    add('context', `Context ${usage?.context.tokens?.toLocaleString('en-US') ?? '—'}/${usage?.context.window?.toLocaleString('en-US') ?? '—'}`, true)
  }
  if (offReason) add('enrichment-off', offReason, true)
  return rows
}
