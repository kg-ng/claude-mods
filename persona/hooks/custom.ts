import { contrast, ensureContrast, isDark, mix, parseHex, rotateHue } from './colors'
import { SKINS } from './themes'
import type { Palette, Skin } from './themes'

/** Every colour a persona carries, in the order `/persona show` lists them. */
export const PALETTE_KEYS = [
  'bg', 'fg', 'muted', 'read', 'write', 'run', 'search', 'web', 'mcp', 'other', 'ok', 'warn', 'err',
] as const satisfies readonly (keyof Palette)[]
export type PaletteKey = (typeof PALETTE_KEYS)[number]

export const KEY_HELP: Record<PaletteKey, string> = {
  bg: 'terminal background', fg: 'body text', muted: 'dim text, borders',
  read: 'Read rows, links', write: 'Edit rows, inline code', run: 'Bash rows', search: 'Grep rows, keywords, h2',
  web: 'accent: bullets, h1, band', mcp: 'MCP tool rows', other: 'other tools, code text',
  ok: 'success, strings', warn: 'warnings, running', err: 'errors',
}

export const NAME_RE = /^[a-z0-9][a-z0-9-]{0,31}$/
export const isBuiltIn = (name: string) => SKINS.some(s => s.name === name)

/** Text must read: fg ≥ 4.5:1 on bg, every other colour ≥ 3:1. Returns the fixed palette and what moved. */
export function readable(p: Palette): { palette: Palette; notes: string[] } {
  const notes: string[] = []
  const out = { ...p }
  for (const key of PALETTE_KEYS) {
    if (key === 'bg') continue
    const min = key === 'fg' ? 4.5 : 3
    const fixed = ensureContrast(out[key], out.bg, min)
    if (fixed !== out[key]) {
      notes.push(`${key} ${out[key]} → ${fixed} (was ${contrast(out[key], out.bg).toFixed(1)}:1 on the background)`)
      out[key] = fixed
    }
  }
  return { palette: out, notes }
}

/**
 * Builds a whole palette from a few colours: a background, text, and one or
 * more accents. Missing roles are derived (hue turns of the first accent;
 * status colours from familiar greens, ambers and reds), then made readable.
 */
export function buildPalette(bg: string, fg: string | undefined, accents: string[]): { palette: Palette; notes: string[] } {
  const dark = isDark(bg)
  const text = fg ?? (dark ? '#d8dee9' : '#2e3440')
  const a0 = accents[0] ?? (dark ? '#7aa2f7' : '#2e7de9')
  const pickAccent = (i: number, turn: number) => accents[i] ?? rotateHue(a0, turn)
  const raw: Palette = {
    bg,
    fg: text,
    muted: mix(text, bg, 0.45),
    web: a0,
    read: pickAccent(1, -40),
    write: pickAccent(2, 150),
    search: pickAccent(3, 60),
    run: pickAccent(4, 190),
    mcp: pickAccent(5, -90),
    other: mix(text, bg, 0.2),
    ok: dark ? '#9ece6a' : '#40a02b',
    warn: dark ? '#e0af68' : '#b7791f',
    err: dark ? '#f7768e' : '#d20f39',
  }
  return readable(raw)
}

export type PersonaFile = {
  name: string
  label?: string
  palette: Partial<Record<PaletteKey, string>>
  spinner?: string[]
  done?: string[]
  icons?: Record<string, string>
  frames?: string[]
  scene?: Skin['scene']
}

const ICON_KINDS = ['read', 'write', 'run', 'search', 'web', 'mcp', 'other'] as const
const SCENE_DIRS = ['up', 'down', 'left', 'right', 'drift', 'twinkle'] as const
/** A glyph: 1-5 printable characters, no controls. */
export const isGlyph = (v: unknown): v is string =>
  typeof v === 'string' && [...v].length >= 1 && [...v].length <= 5 && !/[\u0000-\u001f\u007f]/.test(v)

export function cleanIcons(v: unknown): Skin['icons'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const out: Record<string, string> = {}
  for (const k of ICON_KINDS) if (isGlyph((v as Record<string, unknown>)[k])) out[k] = (v as Record<string, string>)[k]!
  return Object.keys(out).length ? out : undefined
}

export function cleanFrames(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined
  const f = v.filter(isGlyph).slice(0, 12)
  return f.length >= 2 ? f : undefined
}

export function cleanScene(v: unknown): Skin['scene'] | undefined {
  if (!v || typeof v !== 'object') return undefined
  const d = v as Record<string, any>
  const out: NonNullable<Skin['scene']> = {}
  if (typeof d.preset === 'string') out.preset = d.preset.toLowerCase().slice(0, 24)
  const pt = d.particles
  if (pt && typeof pt === 'object') {
    const glyphs = Array.isArray(pt.glyphs) ? pt.glyphs.filter(isGlyph).slice(0, 8) : []
    if (glyphs.length)
      out.particles = {
        glyphs,
        dir: (SCENE_DIRS as readonly string[]).includes(pt.dir) ? pt.dir : 'drift',
        speed: Math.min(5, Math.max(1, Number(pt.speed) || 2)),
        density: Math.min(0.5, Math.max(0.01, Number(pt.density) || 0.05)),
        colors: (Array.isArray(pt.colors) ? pt.colors.map(String) : ['web']).slice(0, 6),
      }
  }
  const sp = d.sprite
  if (sp && typeof sp === 'object' && Array.isArray(sp.frames)) {
    const frames = sp.frames.map(String).filter((f: string) => f.length > 0 && f.length <= 40).slice(0, 12)
    if (frames.length)
      out.sprite = {
        frames,
        every: Math.min(30, Math.max(1, Number(sp.every) || 8)),
        at: sp.at === 'left' || sp.at === 'center' ? sp.at : 'right',
        color: String(sp.color ?? 'web'),
      }
  }
  return Object.keys(out).length ? out : undefined
}

/** Reads a persona from JSON data (an export, a file in the personas folder, the design tool). */
export function fromData(data: unknown, fallbackName?: string): { skin?: Skin; error?: string; notes: string[] } {
  if (!data || typeof data !== 'object') return { error: 'not a persona object', notes: [] }
  const d = data as Record<string, unknown>
  const name = String(d.name ?? fallbackName ?? '').trim().toLowerCase()
  if (!NAME_RE.test(name)) return { error: `bad name "${name}": use a-z, 0-9 and dashes`, notes: [] }
  if (isBuiltIn(name)) return { error: `"${name}" is a built-in persona; pick another name`, notes: [] }
  const pal = (d.palette ?? {}) as Record<string, unknown>
  const bg = parseHex(String(pal.bg ?? ''))
  if (!bg) return { error: 'palette.bg (the background) is required, as hex', notes: [] }
  const given: Partial<Palette> = {}
  for (const key of PALETTE_KEYS) {
    const v = pal[key]
    if (v === undefined) continue
    const hex = parseHex(String(v))
    if (!hex) return { error: `palette.${key} "${String(v)}" is not a colour`, notes: [] }
    given[key] = hex
  }
  const accents = [given.web, given.read, given.write, given.search, given.run, given.mcp].filter((x): x is string => !!x)
  const base = buildPalette(bg, given.fg, accents)
  const { palette, notes } = readable({ ...base.palette, ...given, bg })
  const words = (v: unknown, dflt: string[]) =>
    Array.isArray(v) ? v.map(String).map(s => s.trim()).filter(s => s && s.length <= 24).slice(0, 12) : dflt
  const skin: Skin = {
    name,
    label: String(d.label ?? name).slice(0, 40) || name,
    palette,
    spinner: words(d.spinner, ['Thinking', 'Working', 'Composing']),
    done: words(d.done, ['Done', 'Finished']),
  }
  const icons = cleanIcons(d.icons)
  const frames = cleanFrames(d.frames)
  const scene = cleanScene(d.scene)
  if (icons) skin.icons = icons
  if (frames) skin.frames = frames
  if (scene) skin.scene = scene
  if (skin.spinner.length === 0) skin.spinner = ['Thinking']
  if (skin.done.length === 0) skin.done = ['Done']
  return { skin, notes }
}

export const toData = (s: Skin): PersonaFile => ({
  name: s.name,
  label: s.label,
  palette: Object.fromEntries(PALETTE_KEYS.map(k => [k, s.palette[k]])),
  spinner: s.spinner,
  done: s.done,
  ...(s.icons ? { icons: s.icons as Record<string, string> } : {}),
  ...(s.frames ? { frames: s.frames } : {}),
  ...(s.scene ? { scene: s.scene } : {}),
})
