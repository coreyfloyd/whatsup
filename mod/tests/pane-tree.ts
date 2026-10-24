import type { Mounted } from 'claude-code/testing'

/** Include the actual surface-module drawing, which ui.drawn() keeps separate. */
export async function paneTree(ui: Mounted<any, 'Pane'>): Promise<any> {
  const expand = async (node: any): Promise<any> => {
    if (!node || typeof node !== 'object') return node
    if (node.type === 'Client') return { ...node, children: [await ui.drawn({ in: node.props.key })] }
    return { ...node, children: await Promise.all((node.children ?? []).map(expand)) }
  }
  return expand(await ui.drawn())
}

/** Client-local controls are addressed in their native region. */
export function desktopPane(ui: Mounted<any, 'Pane'>): Mounted<any, 'Pane'> {
  return {
    ...ui,
    find: query => ui.find({ ...query, in: 'desktop-pane' }),
    findAll: query => ui.findAll({ ...query, in: 'desktop-pane' }),
    press: async query => {
      const result = await ui.press({ ...query, in: 'desktop-pane' })
      await ui.advance(32)
      return result
    },
  }
}
