// A persona's scene: particles that move across a strip of rows, and an
// optional sprite that loops its frames at one spot. Drawn while Claude works.
type Dir = 'up' | 'down' | 'left' | 'right' | 'drift' | 'twinkle'
type Props = {
  rows: number
  particles?: { glyphs: string[]; dir: Dir; speed: number; density: number; colors: string[] }
  sprite?: { frames: string[]; every: number; at: 'left' | 'center' | 'right'; color: string }
  ms: number
}
type Part = { x: number; y: number; g: string; c: number; life: number }
type State = { t: number; parts: Part[]; seed: number }

// A small deterministic random, so a scene never needs Math.random's state.
const rnd = (s: number) => {
  const x = Math.sin(s * 9301 + 49297) * 233280
  return x - Math.floor(x)
}

function step(props: Props, cols: number, s: State): State {
  const p = props.particles
  const t = s.t + 1
  if (!p || cols <= 0) return { ...s, t }
  const rows = props.rows
  const every = Math.max(1, 6 - Math.round(p.speed)) // speed 1..5: lower waits more ticks per move
  let seed = s.seed
  const r = () => rnd(++seed)
  const moved: Part[] = []
  for (const q of s.parts) {
    const n = { ...q, life: q.life - 1 }
    if (t % every === 0) {
      if (p.dir === 'down') n.y += 1
      else if (p.dir === 'up') n.y -= 1
      else if (p.dir === 'left') n.x -= 1
      else if (p.dir === 'right') n.x += 1
      else if (p.dir === 'drift') {
        n.x += r() < 0.5 ? -1 : 1
        if (r() < 0.3) n.y += r() < 0.5 ? -1 : 1
      }
    }
    if (n.x >= 0 && n.x < cols && n.y >= 0 && n.y < rows && n.life > 0) moved.push(n)
  }
  // New particles enter where their direction starts, up to the density.
  const want = Math.round(cols * rows * Math.min(0.5, Math.max(0.01, p.density)))
  let spawn = Math.min(Math.max(1, Math.ceil(want / 8)), want - moved.length)
  while (spawn-- > 0) {
    const g = p.glyphs[Math.floor(r() * p.glyphs.length)] ?? '·'
    const c = Math.floor(r() * Math.max(1, p.colors.length))
    const x =
      p.dir === 'left' ? cols - 1 : p.dir === 'right' ? 0 : Math.floor(r() * cols)
    const y =
      p.dir === 'down' ? 0 : p.dir === 'up' ? rows - 1 : Math.floor(r() * rows)
    const life = p.dir === 'twinkle' || p.dir === 'drift' ? 6 + Math.floor(r() * 20) : 999
    moved.push({ x, y, g, c, life })
  }
  return { t, parts: moved, seed }
}

const Scene = (props: Props, surface: any) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ t: 0, parts: [], seed: 7 })
    surface.every(Math.max(50, props.ms || 100), () => {
      const s = (surface.state as State | undefined) ?? { t: 0, parts: [], seed: 7 }
      surface.setState(step(props, surface.columns, s))
    })
  }
  const s = (surface.state as State | undefined) ?? { t: 0, parts: [], seed: 7 }
  const cols = Math.max(0, surface.columns)
  const rows = props.rows
  const grid: { g: string; c: string }[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ({ g: ' ', c: '' })),
  )
  const colors = props.particles?.colors ?? []
  for (const q of s.parts) {
    const cell = grid[q.y]?.[q.x]
    if (cell) {
      cell.g = q.g
      cell.c = colors[q.c] ?? ''
    }
  }
  const sp = props.sprite
  if (sp && sp.frames.length) {
    const frame = sp.frames[Math.floor(s.t / Math.max(1, sp.every)) % sp.frames.length] ?? ''
    const lines = frame.split('\n')
    const w = Math.max(...lines.map(l => [...l].length))
    const x0 = sp.at === 'left' ? 1 : sp.at === 'center' ? Math.floor((cols - w) / 2) : cols - w - 1
    lines.slice(0, rows).forEach((l, dy) => {
      const y = rows - Math.min(rows, lines.length) + dy
      ;[...l].forEach((ch, dx) => {
        const cell = grid[y]?.[x0 + dx]
        if (cell && ch !== ' ') {
          cell.g = ch
          cell.c = sp.color
        }
      })
    })
  }
  // One Text per row, a span per run of one colour, to keep the tree small.
  const rowsOut = grid.map(row => {
    const spans: any[] = []
    let run = ''
    let color = ''
    const flush = () => {
      if (run) spans.push(color ? Text({ color, children: run }) : Text({ children: run }))
      run = ''
    }
    for (const cell of row) {
      if (cell.c !== color) {
        flush()
        color = cell.c
      }
      run += cell.g
    }
    flush()
    return Text({ wrap: 'truncate', children: spans })
  })
  return Box({ flexDirection: 'column', children: rowsOut })
}

export default Scene
