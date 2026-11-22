/** One persona's colours: a role per key, each a `#rrggbb` hex. */
export type Palette = {
  bg: string; fg: string; muted: string
  read: string; write: string; run: string; search: string; web: string; mcp: string; other: string
  ok: string; err: string; warn: string
}

/** A persona: built-in, made with /persona new, imported, or read from the personas folder. */
export type Persona = {
  name: string
  label: string
  palette: Palette
  spinner: string[]
  done: string[]
  /** Tool-row icons by kind; a kind left out keeps the standard icon. */
  icons?: Partial<Record<'read' | 'write' | 'run' | 'search' | 'web' | 'mcp' | 'other', string>>
  /** The spinner's own animation, 2-12 short frames. */
  frames?: string[]
  /** The strip that plays above the prompt while Claude works. */
  scene?: PersonaScene
  /** Where it came from: absent for a built-in. */
  source?: 'mine' | 'file'
}

/** Particles that move across the strip, and an optional sprite looping at one spot. */
export type PersonaScene = {
  /** A named starting point (rain, snow, sparks, …); the fields below override it. */
  preset?: string
  particles?: {
    glyphs: string[]
    dir: 'up' | 'down' | 'left' | 'right' | 'drift' | 'twinkle'
    /** 1 (slow) to 5 (fast). */
    speed: number
    /** Share of the strip filled, 0.01 to 0.5. */
    density: number
    /** Palette keys (web, ok, …) or hex colours. */
    colors: string[]
  }
  sprite?: { frames: string[]; every: number; at: 'left' | 'center' | 'right'; color: string }
}

declare module 'claude-code' {
  interface PluginState {
    persona: {
      current: string
      isBandHidden: boolean
      isBandShown: boolean
      isMotionOff: boolean
      areaOverride: Shaped<Record<'terminal' | 'chat' | 'panels', string>>
      pickChosen: string
      isRepliesOff: boolean
      hovered: string
      customs: Shaped<Persona[]>
    }
  }
}
