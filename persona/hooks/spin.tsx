// The spinner's own animation: a persona's frames, one after another.
type Props = { frames: string[]; color: string; ms: number }
type State = { i: number }

const Spin = (props: Props, surface: any) => {
  const { Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ i: 0 })
    surface.every(Math.max(60, props.ms || 120), () => {
      const s = (surface.state as State | undefined) ?? { i: 0 }
      surface.setState({ i: (s.i + 1) % Math.max(1, props.frames.length) })
    })
  }
  const i = ((surface.state as State | undefined)?.i ?? 0) % Math.max(1, props.frames.length)
  const width = Math.max(...props.frames.map(f => [...f].length), 1)
  const frame = props.frames[i] ?? ''
  return Text({ color: props.color, children: frame + ' '.repeat(width - [...frame].length) })
}

export default Spin
