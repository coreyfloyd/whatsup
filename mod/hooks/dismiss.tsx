import type { ClientModule } from 'claude-code'

type Segment = { text: string; color?: string; backgroundColor?: string; dimColor?: boolean; bold?: boolean; underline?: boolean }
// Text has no native hover inversion. Pointer input posts only a left click;
// moving over the region does not mutate state, style, or the render tree.
const Dismiss: ClientModule<{ parts: Segment[] }> = (props, surface) => {
  const { Text } = surface.elements
  surface.onPointer(event => {
    if (event.type === 'down' && event.button === 'left') surface.post({ dismiss: true })
  })
  return <Text>{props.parts.map(({ text, ...style }, index) => <Text key={String(index)} {...style}>{text}</Text>)}</Text>
}
export default Dismiss
