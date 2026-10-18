import type { ContextReport } from './report'

export type SectionDefinition = { label: string; verb: string; item_kind: string; emoji: string; description: boolean; collapsed: boolean }
export type Template = { template: string; sections: Record<string, SectionDefinition>; section_order: string[]; status_emoji: Record<string, string>; session: { density: 'compact' | 'full' }; motion: boolean; instruction: boolean }
const queue: SectionDefinition = { label: 'Queue', verb: 'finished', item_kind: 'tasks', emoji: '📋', description: false, collapsed: true }
const preferences = {
  status_emoji: { generating: '🐝', reviewing: '🧐', evaluating: '🔬', testing: '🧪', waiting: '🪑', done: '✅', failed: '❌' },
  session: { density: 'compact' as const }, motion: true, instruction: true,
}
export const TEMPLATES: Record<string, Template> = {
  github: { ...preferences, template: 'github', section_order: ['project', 'milestone', 'epic', 'queue'], sections: {
    project: { label: 'Project', verb: 'achieved', item_kind: 'milestones', emoji: '🎯', description: true, collapsed: true },
    milestone: { label: 'Milestone', verb: 'shipped', item_kind: 'epics', emoji: '⛰️', description: true, collapsed: true },
    epic: { label: 'Epic', verb: 'closed', item_kind: 'tickets', emoji: '🚀', description: true, collapsed: true }, queue,
  } },
  'task-list': { ...preferences, template: 'task-list', section_order: ['queue'], sections: { queue } },
  bare: { ...preferences, template: 'bare', section_order: ['queue'], sections: { queue: { ...queue, emoji: '' } } },
}
function object(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function merge(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result = structuredClone(base)
  for (const [key, value] of Object.entries(override)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Invalid configuration key: ${key}`)
    result[key] = object(value) && object(result[key]) ? merge(result[key], value) : structuredClone(value)
  }
  return result
}
function validate(value: unknown, shape: unknown, path = 'config') {
  if (object(shape)) {
    if (!object(value)) throw new Error(`${path}: expected object`)
    for (const [key, entry] of Object.entries(value)) {
      const child = path === 'config.sections' ? queue : path === 'config.status_emoji' ? '' : shape[key]
      if (child === undefined) throw new Error(`${path}.${key}: unknown field`)
      validate(entry, child, `${path}.${key}`)
    }
  } else if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) throw new Error(`${path}: expected string list`)
  } else if (typeof value !== typeof shape) throw new Error(`${path}: expected ${typeof shape}`)
}
/** Precedence: built-in template, user overrides, repository overrides. Arrays replace. */
export function resolveConfig(user: unknown = {}, repository: unknown = {}): Template {
  for (const file of [user, repository]) validate(file, TEMPLATES.github)
  const overrides = merge(user as Record<string, unknown>, repository as Record<string, unknown>)
  const name = overrides.template ?? 'github'
  if (typeof name !== 'string' || !Object.hasOwn(TEMPLATES, name)) throw new Error(`config.template: unknown template ${name}`)
  const resolved = merge(TEMPLATES[name] as unknown as Record<string, unknown>, overrides) as unknown as Template
  if (!['compact', 'full'].includes(resolved.session.density)) throw new Error('config.session.density: expected compact or full')
  if (new Set(resolved.section_order).size !== resolved.section_order.length) throw new Error('config.section_order: duplicate section')
  for (const key of resolved.section_order) {
    if (!Object.hasOwn(resolved.sections, key)) throw new Error(`config.section_order: unknown section ${key}`)
    for (const field of Object.keys(queue)) if (!(field in resolved.sections[key])) throw new Error(`config.sections.${key}.${field}: required`)
  }
  return resolved
}
export const configKey = (session: string) => `template-config:${session}`
export function sessionInstruction(config: Template): string {
  if (!config.instruction) return ''
  const sections = config.section_order.map(key => {
    const { label, verb, item_kind } = config.sections[key]
    return { label, verb, item_kind }
  })
  const descriptions = config.section_order.filter(key => config.sections[key].description).map(key => config.sections[key].label)
  const instruction = `When asked to "report your context", or when work starts, changes or finishes, call mcp__whatsup__report. Replace the whole report: scope; optional sections and workers. For sections, copy verbatim these exact label, verb and item_kind values in order, preserving case and plurals:
${JSON.stringify(sections)}
Include descriptions for labels ${JSON.stringify(descriptions)}. Each section may add name and items (title, state queued/active/done; number, identity, link when known). Report workers launched by any means: name, role, status, state; model and task when known. Report only known work; omit unavailable sections. Reports are display state.`
  // Arbitrary user labels must never produce an over-budget startup instruction.
  if (instruction.split(/\s+/).length >= 120) throw new Error('config: reporting instruction must stay under 120 words; shorten section labels or reduce sections')
  return instruction
}
export function initialExpanded(config: Template, report: ContextReport | null): number[] {
  return (report?.sections ?? []).flatMap((section, index) => Object.values(config.sections).some(def => def.label === section.label && !def.collapsed) ? [index] : [])
}
