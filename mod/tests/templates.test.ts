import { describe, expect, test } from 'claude-code/testing'
import * as templates from '../hooks/templates'

describe('templates and configuration', () => {
  test('ships the three section vocabularies and presentation preferences', () => {
    expect(Object.keys(templates.TEMPLATES ?? {})).toEqual(['github', 'task-list', 'bare'])
    const github = templates.resolveConfig()
    expect(github.section_order.map(key => github.sections[key].item_kind)).toEqual(['milestones', 'epics', 'tickets', 'tasks'])
    expect(github.section_order.map(key => github.sections[key].verb)).toEqual(['achieved', 'shipped', 'closed', 'finished'])
    expect(github.section_order.map(key => github.sections[key].emoji)).toEqual(['🎯', '⛰️', '🚀', '📋'])
    for (const template of Object.values(templates.TEMPLATES)) {
      expect(template.session.density).toBe('compact')
      expect(template.status_emoji.generating).toBe('🐝')
      expect(template.sections.queue.description).toBe(false)
    }
    expect(templates.resolveConfig({ template: 'task-list' }).section_order).toEqual(['queue'])
    expect(templates.resolveConfig({ template: 'bare' }).section_order).toEqual(['queue'])
  })
  test('resolves neither, user only, repository only and both with nested overrides', () => {
    expect(templates.resolveConfig().template).toBe('github')
    expect(templates.resolveConfig({ template: 'bare' }).template).toBe('bare')
    expect(templates.resolveConfig(undefined, { template: 'task-list' }).template).toBe('task-list')
    const config = templates.resolveConfig({ template: 'bare', session: { density: 'full' }, status_emoji: { done: '🎉' } },
      { template: 'github', sections: { epic: { label: 'Delivery', collapsed: false } }, motion: false, instruction: false })
    expect(config.sections.epic.label).toBe('Delivery')
    expect(config.sections.epic.verb).toBe('closed')
    expect(config.sections.epic.collapsed).toBe(false)
    expect(config.session.density).toBe('full')
    expect(config.status_emoji.done).toBe('🎉')
    expect(config.motion).toBe(false)
    expect(config.instruction).toBe(false)
    expect(templates.resolveConfig().sections.epic.label).toBe('Epic')
  })
  test('instruction describes active fields and update triggers within 119 words', () => {
    for (const template of ['github', 'task-list', 'bare']) {
      const instruction = templates.sessionInstruction(templates.resolveConfig(undefined, { template }))
      expect(instruction.trim().split(/\s+/).length < 120).toBe(true)
      for (const term of ['scope', 'label', 'verb', 'item_kind', 'title', 'state', 'starts', 'changes', 'finishes', 'any means', 'mcp__whatsup__report']) expect(instruction).toContain(term)
      expect(instruction).toContain('Queue')
    }
    expect(templates.sessionInstruction(templates.resolveConfig(undefined, { instruction: false }))).toBe('')
  })
  test('report requests copy exact configured section field values', () => {
    for (const config of [
      ...Object.keys(templates.TEMPLATES).map(template => templates.resolveConfig({ template })),
      templates.resolveConfig(undefined, { sections: { epic: { label: 'Delivery' } } }),
    ]) {
      const instruction = templates.sessionInstruction(config)
      expect(instruction).toContain('"report your context"')
      expect(instruction).toContain('copy verbatim')
      const definitions = instruction.split('\n').find(line => line.startsWith('['))
      expect(definitions).toBeDefined()
      expect(JSON.parse(definitions!)).toEqual(config.section_order.map(key => {
        const { label, verb, item_kind } = config.sections[key]
        return { label, verb, item_kind }
      }))
    }
  })
  test('keeps custom startup instructions under budget', () => {
    expect(() => templates.sessionInstruction(templates.resolveConfig(undefined, { sections: { queue: { label: 'queue '.repeat(120) } } }))).toThrow()
  })
  test('rejects unknown templates and malformed preference types', () => {
    for (const config of [{ template: 'missing' }, null, { motion: 'off' }, { sections: { queue: { collapsed: 'yes' } } }, { session: { density: 'huge' } }]) {
      expect(() => templates.resolveConfig(undefined, config)).toThrow()
    }
  })
})
