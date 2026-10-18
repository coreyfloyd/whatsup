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
