/** Public report contract. The interface document reproduces REPORT_SCHEMA verbatim. */
export type ReportItem = { title: string; number?: number; identity?: string; link?: string; state: 'queued' | 'active' | 'done' }
export type ReportSection = { label: string; name?: string; verb: string; item_kind: string; description?: string; identity?: string; link?: string; items?: ReportItem[]; fields?: { label: string; value: string }[] }
export type Worker = { name: string; role: string; status: string; state: 'running' | 'waiting' | 'done' | 'failed'; model?: string; task?: string | ReportItem; first_seen?: string; last_state_change?: string; tokens?: number[]; total?: number; context?: { tokens: number; window: number }; source?: 'observed' | 'reported' | 'both' }
export type DecisionOption = { identity: string; label: string; benefit: string; cost: string }
export type Decision = { identity: string; question: string; why_now: string; context: string; options: DecisionOption[]; recommendation: { option: string; reason: string } }
/** Canonical answer-relevant version, independent of object property insertion order. */
export const decisionVersion = (decision: Decision): string => JSON.stringify([
  decision.identity, decision.question, decision.why_now, decision.context,
  decision.options.map(option => [option.identity, option.label, option.benefit, option.cost]),
  decision.recommendation.option, decision.recommendation.reason,
])
export type ContextReport = { scope: string; decisions?: Decision[]; sections?: ReportSection[]; workers?: Worker[] }

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; additionalProperties?: boolean; items?: Schema; enum?: string[]; minimum?: number; anyOf?: Schema[]; description?: string; minLength?: number; pattern?: string; minItems?: number }
const string: Schema = { type: 'string' }
const item: Schema = {
  type: 'object', additionalProperties: false, required: ['title', 'state'],
  properties: { title: string, number: { type: 'integer', minimum: 1 }, identity: string, link: string, state: { type: 'string', enum: ['queued', 'active', 'done'] } },
}
const requiredText: Schema = { type: 'string', minLength: 1, pattern: '\\S' }
const decision: Schema = {
  type: 'object', additionalProperties: false, required: ['identity', 'question', 'why_now', 'context', 'options', 'recommendation'],
  properties: {
    identity: requiredText, question: requiredText, why_now: requiredText, context: requiredText,
    options: { type: 'array', minItems: 2, items: {
      type: 'object', additionalProperties: false, required: ['identity', 'label', 'benefit', 'cost'],
      properties: { identity: requiredText, label: requiredText, benefit: requiredText, cost: requiredText },
    } },
    recommendation: { type: 'object', additionalProperties: false, required: ['option', 'reason'], properties: { option: requiredText, reason: requiredText } },
  },
}
export const REPORT_SCHEMA: Schema = {
  type: 'object', additionalProperties: false, required: ['scope'],
  properties: {
    scope: { type: 'string', description: 'One line describing what this session is working on.' },
    decisions: { type: 'array', items: decision },
    sections: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['label', 'verb', 'item_kind'],
        properties: {
          label: string, name: string, verb: string, item_kind: string, description: string, identity: string, link: string,
          items: { type: 'array', items: item },
          fields: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['label', 'value'], properties: { label: string, value: string } } },
        },
      },
    },
    workers: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['name', 'role', 'status', 'state'],
        properties: {
          name: string, role: string, status: string, state: { type: 'string', enum: ['running', 'waiting', 'done', 'failed'] },
          model: string, task: { anyOf: [string, item] }, first_seen: string, last_state_change: string,
          tokens: { type: 'array', items: { type: 'integer', minimum: 0 } }, total: { type: 'integer', minimum: 0 },
          context: { type: 'object', additionalProperties: false, required: ['tokens', 'window'], properties: { tokens: { type: 'integer', minimum: 0 }, window: { type: 'integer', minimum: 1 } } },
          source: { type: 'string', enum: ['observed', 'reported', 'both'] },
        },
      },
    },
  },
}
export const REPORT_TOOL = 'mcp__whatsup__report'
export const REPORT_DESCRIPTION = 'Replace this session’s entire context report: scope text; optional ordered sections (label, name, verb, item_kind, description, items, fields); items (title, number, identity, link, queued/active/done state), each exactly one unit of its section’s item_kind that belongs to that section (one ticket, never a group of tickets or work from another container), with groupings and work steps in the queue section; optional workers (name, role, status, state, model, task, times and token usage). Minimum: {"scope":"What I am working on"}. Omitted sections, workers and decisions clear the previous lists. Decisions require stable identity, question, why_now, answer-sufficient context, at least two options (identity, label, benefit, cost), and recommendation (option identity, reason). Retain outstanding decisions in every complete report; update missing context during discussion and remove only resolved or withdrawn decisions, including resolutions from custom answers in chat. Discussion requests leave decisions pending; submission acceptance is not resolution. Keep identities stable across unchanged reports; changed question, context, options or recommendation creates a new version. Validation checks structure and nonempty text, not prose truth or sufficiency. This is display state, not authorization.'
export const reportKey = (session: string) => `context-report:${session}`

/** The engine spreads a tool's arguments beside its own keys on the `tool.call` event; this keeps only the arguments. */
export function reportArguments(event: object): Record<string, unknown> {
  const { tool: _tool, tool_use_id: _call, agentId: _agent, requestMeta: _meta, consent: _consent, ...input } = event as Record<string, unknown>
  return input
}

/** Validate against the same JSON schema registered with the model, before any write. */
export function reportError(value: unknown, schema: Schema = REPORT_SCHEMA, path = 'report'): string | null {
  if (schema.anyOf) return schema.anyOf.some(branch => reportError(value, branch, path) === null) ? null : `${path}: expected text or an item`
  const kind = schema.type
  if (kind === 'object') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return `${path}: expected object`
    const record = value as Record<string, unknown>
    for (const field of schema.required ?? []) if (!Object.hasOwn(record, field)) return `${path}.${field}: required`
    for (const [key, entry] of Object.entries(record)) {
      const child = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined
      if (!child && schema.additionalProperties === false) return `${path}.${key}: unknown field`
      if (child) { const error = reportError(entry, child, `${path}.${key}`); if (error) return error }
    }
  } else if (kind === 'array') {
    if (!Array.isArray(value)) return `${path}: expected array`
    if (value.length < (schema.minItems ?? 0)) return `${path}: expected at least ${schema.minItems} entries`
    for (let index = 0; index < value.length; index++) {
      const error = reportError(value[index], schema.items!, `${path}[${index}]`)
      if (error) return error
    }
  } else if (kind === 'string' && typeof value !== 'string') return `${path}: expected string`
  else if (kind === 'integer' && (!Number.isInteger(value) || (value as number) < (schema.minimum ?? -Infinity))) return `${path}: expected integer >= ${schema.minimum ?? 0}`
  if (kind === 'string' && typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: expected nonblank text`
  if (schema === REPORT_SCHEMA) {
    const identities = new Set<string>()
    for (const [index, entry] of ((value as ContextReport).decisions ?? []).entries()) {
      const at = `${path}.decisions[${index}]`
      if (identities.has(entry.identity)) return `${at}.identity: duplicate decision identity`
      identities.add(entry.identity)
      const options = new Set<string>()
      for (const [optionIndex, option] of entry.options.entries()) {
        if (options.has(option.identity)) return `${at}.options[${optionIndex}].identity: duplicate option identity`
        options.add(option.identity)
      }
      if (!options.has(entry.recommendation.option)) return `${at}.recommendation.option: absent option`
    }
  }
  if (schema.enum && !schema.enum.includes(value as string)) return `${path}: expected ${schema.enum.join(', ')}`
  return null
}
