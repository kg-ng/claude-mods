import type { Palette } from './themes'
import { ensureContrast, hueSat, isDark, mix } from './colors'

/**
 * The terminal running this session, painted in the persona.
 * - Apple Terminal: AppleScript on the tab found by its tty (a profile with all 16 colours).
 * - Other terminals (iTerm2, Windows Terminal, kitty, WezTerm, Ghostty, Alacritty, VS Code,
 *   GNOME/VTE, xterm): the standard OSC 4/10/11/12 colour sequences, written to the session's
 *   tty (macOS, Linux) or console (Windows), wrapped for tmux, and reset with OSC 104/110-112.
 * - A terminal that takes none of these (the Linux console, `dumb`): left alone.
 */
type $Like = {
  env: { get: (k: string) => Promise<string | undefined> }
  fs: { write: (path: string, text: string) => Promise<unknown> }
  process: { run: (argv: readonly string[], init?: { timeoutMs?: number }) => Promise<{ exitCode: number; stdout: string; stderr: string }> }
  store: { get: (k: string) => Promise<unknown>; set: (k: string, v: unknown) => Promise<void> }
}

const FIND = `on findTab(ttyPath)
tell application "Terminal"
repeat with w in windows
repeat with t in tabs of w
if tty of t is ttyPath then return t
end repeat
end repeat
end tell
return missing value
end findTab
`

const rgb = (hex: string): string => {
  const n = parseInt(hex.slice(1), 16)
  return `{${((n >> 16) & 255) * 257}, ${((n >> 8) & 255) * 257}, ${(n & 255) * 257}}`
}

type Where =
  | { kind: 'apple'; tty: string }
  | { kind: 'osc'; tty: string; tmux: boolean }
  | { kind: 'windows'; temp: string }
  | { kind: 'none'; why: string }

let whereCache: Where | undefined

/** Where this session draws, and how its colours can be set. */
async function locate($: $Like): Promise<Where> {
  if (whereCache) return whereCache
  const env = async (k: 'OS' | 'TERM' | 'TEMP' | 'TMUX') => {
    if (k === 'OS') return $.env.get('OS')
    if (k === 'TERM') return $.env.get('TERM')
    if (k === 'TEMP') return $.env.get('TEMP')
    return $.env.get('TMUX')
  }
  if ((await env('OS')) === 'Windows_NT') {
    const temp = await env('TEMP')
    whereCache = temp ? { kind: 'windows', temp } : { kind: 'none', why: 'no TEMP folder' }
    return whereCache
  }
  const term = (await env('TERM')) ?? ''
  if (term === 'linux' || term === 'dumb') return (whereCache = { kind: 'none', why: `the ${term} console has no colour settings` })
  try {
    // The helper that runs this shell often has no tty (`??` on macOS, `?` on Linux),
    // so walk up the parents until one does: that is Claude Code's own terminal.
    const findTty =
      'echo "$TERM_PROGRAM"; p=$PPID; while [ -n "$p" ] && [ "$p" -gt 1 ]; do ' +
      't=$(ps -o tty= -p "$p" | tr -d " "); ' +
      'if [ -n "$t" ] && [ "$t" != "??" ] && [ "$t" != "?" ]; then echo "$t"; exit 0; fi; ' +
      'p=$(ps -o ppid= -p "$p" | tr -d " "); done; echo "?"'
    const r = await $.process.run(['/bin/sh', '-c', findTty], { timeoutMs: 5000 })
    const [prog, tty] = r.stdout.split('\n').map(x => x.trim())
    if (!tty || tty === '?') whereCache = { kind: 'none', why: 'no terminal found for this session' }
    else if (prog === 'Apple_Terminal') whereCache = { kind: 'apple', tty: `/dev/${tty}` }
    else whereCache = { kind: 'osc', tty: tty.startsWith('/') ? tty : `/dev/${tty}`, tmux: !!(await env('TMUX')) }
  } catch {
    whereCache = { kind: 'none', why: 'could not find the terminal' }
  }
  return whereCache
}

// ── Other terminals: OSC colour sequences ──────────────────────────────────

const xcolor = (hex: string) => `rgb:${hex.slice(1, 3)}/${hex.slice(3, 5)}/${hex.slice(5, 7)}`
const ORDER = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'] as const

/** The sequences that set the 16 colours, text, background and cursor. */
export function oscSet(p: Palette): string {
  const c = profileColors(p)
  const ansi = [...ORDER.map(n => c[`ANSI${n}Color`]!), ...ORDER.map(n => c[`ANSIBright${n}Color`]!)]
  return (
    ansi.map((hex, i) => `\x1b]4;${i};${xcolor(hex)}\x07`).join('') +
    `\x1b]10;${xcolor(p.fg)}\x07\x1b]11;${xcolor(p.bg)}\x07\x1b]12;${xcolor(p.web)}\x07`
  )
}

/** The sequences that put the terminal's own colours back. */
export const OSC_RESET = '\x1b]104\x07\x1b]110\x07\x1b]111\x07\x1b]112\x07'

/** tmux passes a sequence on to the outer terminal inside a DCS (needs `allow-passthrough on`). */
const forTmux = (seq: string) => `\x1bPtmux;${seq.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`

async function writeOsc($: $Like, w: Where, seq: string): Promise<string> {
  if (w.kind === 'osc') {
    const out = w.tmux ? forTmux(seq) : seq
    const r = await $.process.run(['/bin/sh', '-c', 'printf %s "$1" > "$2"', 'sh', out, w.tty], { timeoutMs: 5000 })
    return r.exitCode === 0 ? '' : r.stderr.trim() || 'could not write to the terminal'
  }
  if (w.kind === 'windows') {
    // Windows Terminal, and the console PowerShell and cmd open in on Windows 10+, read
    // these from the console device; a child's own output is captured, so go through CON.
    const file = `${w.temp}\\claude-persona-colors.txt`
    await $.fs.write(file, seq)
    const r = await $.process.run(['cmd.exe', '/d', '/s', '/c', `type "${file}" > CON`], { timeoutMs: 5000 })
    return r.exitCode === 0 ? '' : r.stderr.trim() || 'could not write to the console'
  }
  return w.kind === 'none' ? w.why : ''
}

function osa($: $Like, script: string, ...args: string[]) {
  return $.process.run(['/usr/bin/osascript', '-e', script, ...args], { timeoutMs: 10000 })
}

/** Saves the tab's own colours once, so `restore` can put them back. */
async function saveOriginal($: $Like, tty: string): Promise<void> {
  const key = `original:${tty}`
  if (await $.store.get(key)) return
  const r = await osa($, `${FIND}on run argv
set t to findTab(item 1 of argv)
if t is missing value then return ""
tell application "Terminal" to return {background color of t, normal text color of t, bold text color of t, cursor color of t}
end run`, tty)
  const nums = r.stdout.trim().split(/,\s*/).map(Number)
  if (r.exitCode === 0 && nums.length === 12 && nums.every(n => Number.isFinite(n))) await $.store.set(key, nums)
}

async function setColors($: $Like, tty: string, bg: string, fg: string, bold: string, cursor: string) {
  return osa($, `${FIND}on run argv
set t to findTab(item 1 of argv)
if t is missing value then return "no tab"
tell application "Terminal"
set background color of t to ${bg}
set normal text color of t to ${fg}
set bold text color of t to ${bold}
set cursor color of t to ${cursor}
end tell
return "ok"
end run`, tty)
}

/** Paints this session's Terminal tab in the palette's background, text and cursor. Resolves why not, or ''. */
async function paintTab($: $Like, tty: string, p: Palette): Promise<string> {
  const r = await setColors($, tty, rgb(p.bg), rgb(p.fg), rgb(p.fg), rgb(p.web))
  return r.exitCode === 0 && r.stdout.trim() === 'ok' ? '' : (r.stderr.trim() || r.stdout.trim() || 'osascript failed')
}

// ── Terminal profiles: all 16 ANSI colours ─────────────────────────────────

const ANSI_NAMES = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'] as const
const HUES: Record<string, number> = { Red: 0, Yellow: 55, Green: 120, Cyan: 185, Blue: 220, Magenta: 300 }
const ACCENTS = ['err', 'ok', 'warn', 'run', 'read', 'web', 'search', 'mcp', 'write'] as const

/** The palette colour nearest a hue, or `fallback` for a grey palette or nothing within 45 degrees. */
function nearest(p: Palette, hue: number, fallback: string, used: string[] = []): string {
  let best = ''
  let gap = 60
  for (const k of ACCENTS) {
    const { h, s } = hueSat(p[k])
    if (s < 0.25 || used.includes(p[k])) continue
    const d = Math.min(Math.abs(h - hue), 360 - Math.abs(h - hue))
    if (d < gap) [best, gap] = [p[k], d]
  }
  return best || fallback
}

/** The palette spread over Terminal's 16 ANSI colours, plus its background, text, cursor and selection. */
export function profileColors(p: Palette): Record<string, string> {
  const dark = isDark(p.bg)
  const lift = dark ? '#ffffff' : '#000000'
  const base: Record<string, string> = {
    Black: dark ? mix(p.bg, '#000000', 0.25) : mix(p.fg, '#000000', 0.3),
    White: dark ? mix(p.fg, p.bg, 0.12) : mix(p.bg, '#000000', 0.12),
    Red: p.err,
    Green: p.ok,
    Yellow: p.warn,
  }
  // Cyan, then blue, then magenta, each from a palette colour the others did not take.
  const used = [p.err, p.ok, p.warn]
  for (const n of ['Cyan', 'Blue', 'Magenta'] as const) {
    const fallback = n === 'Blue' ? p.web : n === 'Magenta' ? p.search : p.read
    base[n] = nearest(p, HUES[n]!, fallback, used)
    used.push(base[n]!)
  }
  const out: Record<string, string> = {
    BackgroundColor: p.bg,
    TextColor: p.fg,
    TextBoldColor: p.fg,
    CursorColor: p.web,
    SelectionColor: mix(p.bg, p.web, 0.3),
  }
  for (const n of ANSI_NAMES) {
    const c = n === 'Black' || n === 'White' ? base[n]! : ensureContrast(base[n]!, p.bg, 3)
    out[`ANSI${n}Color`] = c
    out[`ANSIBright${n}Color`] =
      n === 'Black' ? p.muted : n === 'White' ? (dark ? mix(p.fg, '#ffffff', 0.4) : '#ffffff') : mix(c, lift, 0.2)
  }
  return out
}

/** Builds `<dir>/<name>.terminal` from the base profile (font, size, window) with the colours replaced. */
const BUILD = `ObjC.import('AppKit')
function run(argv) {
  const [base, name, dir, json] = argv
  const colors = JSON.parse(json)
  $.NSFileManager.defaultManager.createDirectoryAtPathWithIntermediateDirectoriesAttributesError(dir, true, $(), null)
  const all = $.NSUserDefaults.alloc.initWithSuiteName('com.apple.Terminal').dictionaryForKey('Window Settings')
  const src = all.isNil() ? all : all.objectForKey(base)
  const d = src.isNil() ? $.NSMutableDictionary.alloc.init : src.mutableCopy
  let alpha = 1
  const oldBg = d.objectForKey('BackgroundColor')
  if (!oldBg.isNil()) {
    const c = $.NSKeyedUnarchiver.unarchivedObjectOfClassFromDataError($.NSColor, oldBg, null)
    if (!c.isNil()) alpha = c.alphaComponent
  }
  for (const k in colors) {
    const n = parseInt(colors[k].slice(1), 16)
    const a = k === 'BackgroundColor' ? alpha : 1
    const c = $.NSColor.colorWithSRGBRedGreenBlueAlpha(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a)
    d.setObjectForKey($.NSKeyedArchiver.archivedDataWithRootObjectRequiringSecureCodingError(c, false, null), k)
  }
  d.setObjectForKey(name, 'name')
  d.setObjectForKey('Window Settings', 'type')
  if (d.objectForKey('ProfileCurrentVersion').isNil()) d.setObjectForKey($(2.07), 'ProfileCurrentVersion')
  const file = dir + '/' + name + '.terminal'
  return d.writeToFileAtomically(file, true) ? file : ''
}`

/**
 * Adds the profile to Terminal (replacing an older one of that name) and puts this tab on it.
 * Adding opens a window from the file; that window is closed again.
 */
const INSTALL = `${FIND}on run argv
set ttyPath to item 1 of argv
set profName to item 2 of argv
set filePath to item 3 of argv
set baseName to item 4 of argv
set t to findTab(ttyPath)
if t is missing value then return "no tab"
tell application "Terminal"
if filePath is not "" then
if exists settings set profName then
if name of current settings of t is profName then set current settings of t to settings set baseName
delete settings set profName
end if
set oldIds to id of windows
do shell script "/usr/bin/open -g " & quoted form of filePath
repeat 60 times
if exists settings set profName then exit repeat
delay 0.1
end repeat
if not (exists settings set profName) then return "Terminal did not add the profile"
delay 0.3
set newIds to {}
repeat with w in windows
if oldIds does not contain (id of w) then set end of newIds to (id of w)
end repeat
repeat with i in newIds
close (every window whose id is i)
end repeat
end if
if not (exists settings set profName) then return "missing"
set current settings of t to settings set profName
end tell
return "ok"
end run`

const profileName = (label: string) => `Persona ${label}`.replace(/[/:\\]/g, '-')

async function currentProfile($: $Like, tty: string): Promise<string> {
  const r = await osa($, `${FIND}on run argv
set t to findTab(item 1 of argv)
if t is missing value then return ""
tell application "Terminal" to return name of current settings of t
end run`, tty)
  return r.exitCode === 0 ? r.stdout.trim() : ''
}

/** Puts this tab on a profile in the persona's colours, building it when it is new or its colours changed. */
async function applyProfile($: $Like, tty: string, p: Palette, label: string): Promise<string> {
  const origKey = `profile:${tty}`
  let base = (await $.store.get(origKey)) as string | undefined
  if (!base) {
    const now = await currentProfile($, tty)
    if (!now) return 'could not read the tab\'s profile'
    if (!now.startsWith('Persona ')) await $.store.set(origKey, now)
    base = now.startsWith('Persona ') ? 'Basic' : now
  }
  const name = profileName(label)
  const colors = profileColors(p)
  const stamp = `${base}|${JSON.stringify(colors)}`
  const built = ((await $.store.get('profiles')) ?? {}) as Record<string, string>
  let file = ''
  if (built[name] !== stamp) {
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    const r = await $.process.run(
      ['/usr/bin/osascript', '-l', 'JavaScript', '-e', BUILD, base, name, `${home}/.claude/persona-profiles`, JSON.stringify(colors)],
      { timeoutMs: 15000 },
    )
    file = r.stdout.trim()
    if (r.exitCode !== 0 || !file) return r.stderr.trim() || 'could not write the profile'
  }
  let r = await osa($, INSTALL, tty, name, file, base)
  if (r.stdout.trim() === 'missing') {
    // Deleted in Terminal's settings since: build it again.
    await $.store.set('profiles', { ...built, [name]: '' })
    return applyProfile($, tty, p, label)
  }
  if (r.exitCode !== 0 || r.stdout.trim() !== 'ok') return r.stderr.trim() || r.stdout.trim() || 'osascript failed'
  if (file) await $.store.set('profiles', { ...built, [name]: stamp })
  return ''
}

/**
 * Paints this session's Terminal tab in the persona: with `label`, a Terminal profile
 * carrying all 16 ANSI colours; without, or if that fails, the tab's background, text
 * and cursor alone. Resolves why not, or ''.
 */
export async function applyTerminal($: $Like, p: Palette, label?: string): Promise<string> {
  const w = await locate($)
  if (w.kind === 'none') return '' // a terminal with no colour settings: nothing to paint
  if (w.kind !== 'apple') {
    const why = await writeOsc($, w, oscSet(p))
    if (!why) await $.store.set('isOscPainted', true)
    return why
  }
  const tty = w.tty
  await saveOriginal($, tty)
  if (label) {
    const why = await applyProfile($, tty, p, label).catch(String)
    if (!why) return ''
    const fallback = await paintTab($, tty, p)
    return `profile: ${why}` + (fallback ? `; ${fallback}` : '')
  }
  return paintTab($, tty, p)
}

/** Puts the tab's own profile and colours back. */
export async function restoreTerminal($: $Like): Promise<string> {
  const w = await locate($)
  if (w.kind === 'none') return w.why
  if (w.kind !== 'apple') {
    const why = await writeOsc($, w, OSC_RESET)
    if (!why) await $.store.set('isOscPainted', false)
    return why
  }
  const tty = w.tty
  const base = (await $.store.get(`profile:${tty}`)) as string | undefined
  if (base) {
    const r = await osa($, `${FIND}on run argv
set t to findTab(item 1 of argv)
if t is missing value then return "no tab"
tell application "Terminal"
if not (exists settings set (item 2 of argv)) then return "no profile"
set current settings of t to settings set (item 2 of argv)
end tell
return "ok"
end run`, tty, base)
    if (r.stdout.trim() === 'ok') return ''
  }
  const nums = (await $.store.get(`original:${tty}`)) as number[] | undefined
  if (!Array.isArray(nums) || nums.length !== 12) return 'no saved colours for this tab'
  const c = (i: number) => `{${nums[i]}, ${nums[i + 1]}, ${nums[i + 2]}}`
  const r = await setColors($, tty, c(0), c(3), c(6), c(9))
  return r.exitCode === 0 ? '' : (r.stderr.trim() || 'osascript failed')
}
