// Shared with every local mod: the CLI theme the persona mod publishes.
// persona writes ~/.claude/persona-active.json whenever the persona changes;
// a mod reads it here and paints its own chrome with those colours.
// Keep this file identical in each mod that follows the theme.
import type { EngineInterface } from 'claude-code'
import type { Look } from '../types'

export type { Look }


export const BASE_LOOK: Look = {
  name: '',
  accent: 'suggestion',
  ok: 'success',
  err: 'error',
  warn: 'warning',
  muted: 'inactive',
  fg: 'text',
}

export const LOOK_FILE = '.claude/persona-active.json'
export const LOOK_EVERY_MS = 2000

const HEX = /^#[0-9a-fA-F]{6}$/
const hex = (v: unknown, fallback: string) => (typeof v === 'string' && HEX.test(v) ? v : fallback)

/** Turns the published file's data into a Look; anything missing keeps the theme key. */
export function toLook(data: unknown): Look {
  if (!data || typeof data !== 'object') return BASE_LOOK
  const d = data as { name?: unknown; palette?: Record<string, unknown> }
  const p = d.palette ?? {}
  return {
    name: typeof d.name === 'string' ? d.name : '',
    accent: hex(p.web, BASE_LOOK.accent),
    ok: hex(p.ok, BASE_LOOK.ok),
    err: hex(p.err, BASE_LOOK.err),
    warn: hex(p.warn, BASE_LOOK.warn),
    muted: hex(p.muted, BASE_LOOK.muted),
    fg: hex(p.fg, BASE_LOOK.fg),
  }
}

async function lookPath($: EngineInterface): Promise<string> {
  return `${(await $.env.get('HOME')) ?? ''}/${LOOK_FILE}`
}

/**
 * Watches the published theme and calls `apply` with each new Look; resolves once the
 * first one is applied, so a pane is themed from its first draw.
 * A missing or broken file gives BASE_LOOK, so the pane keeps the terminal theme.
 */
export async function watchLook($: EngineInterface, apply: (look: Look) => unknown): Promise<void> {
  let seen = -1
  const check = async () => {
    try {
      const path = await lookPath($)
      const stat = await $.fs.stat(path).catch(() => undefined)
      const mtime = stat?.mtimeMs ?? 0
      if (mtime === seen) return
      seen = mtime
      if (!stat) return void (await apply(BASE_LOOK))
      await apply(toLook(JSON.parse(await $.fs.read(path))))
    } catch {
      await apply(BASE_LOOK)
    }
  }
  $.clock.every(LOOK_EVERY_MS, () => void check())
  await check()
}

/** Props for secondary text: the persona's muted colour, or the terminal's dim. */
export const dim = (L: Look): { color: string } | { dimColor: true } => (L.name ? { color: L.muted } : { dimColor: true })
