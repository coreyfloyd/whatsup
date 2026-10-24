import type { ClientModule, RenderElement } from 'claude-code'

type Tree = { type: string; props: Record<string, any>; children?: (Tree | string)[] }
type Props = { tree: Tree; revision: number; sequence: number }
type State = { props: Props; pressed: boolean; released: boolean; sequence: number }

// One native region includes its border, gap and empty-space pointer targets.
// Revision and sequence checks keep stale or replayed commands from acting twice.
const DesktopPane: ClientModule<any, State> = (props: Props, surface) => {
  const command = (value: { action?: string; dismiss?: true }, revision = surface.state!.props.revision) => {
    const state = surface.state!
    surface.post({ ...value, revision, sequence: ++state.sequence })
  }
  if (!surface.state) {
    surface.setState({ props, pressed: false, released: false, sequence: props.sequence })
    surface.every(16, () => {
      const state = surface.state!
      if (state.released) {
        state.released = false
        if (!state.pressed) command({ dismiss: true })
      }
    })
  }
  const state = surface.state!
  state.props = props
  state.sequence = Math.max(state.sequence, props.sequence)
  surface.onPointer(event => {
    if (event.button !== 'left') return
    if (event.type === 'down') { state.pressed = false; state.released = false }
    if (event.type === 'up') state.released = true
  })
  const draw = (node: Tree | string): RenderElement | string => {
    if (typeof node === 'string') return node
    const children = (node.children ?? []).map(draw)
    const { Box, Text, Button } = surface.elements
    if (node.type === 'Button') return <Button {...node.props} onPress={() => {
      state.pressed = true
      command({ action: node.props.key }, props.revision)
    }}>{children}</Button>
    return node.type === 'Text' ? <Text {...node.props}>{children}</Text> : <Box {...node.props}>{children}</Box>
  }
  return draw(props.tree) as RenderElement
}
export default DesktopPane
