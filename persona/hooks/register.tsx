import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import { DEFAULT_SKIN, ICONS, SCENES, SKINS, findSkin, kindOf, sceneProps } from './themes'
import type { Skin } from './themes'
import { renderMarkdown } from './markdown'
import { applyTerminal, restoreTerminal } from './terminal'
import { KEY_HELP, NAME_RE, PALETTE_KEYS, buildPalette, cleanFrames, cleanIcons, cleanScene, fromData, isBuiltIn, isGlyph, readable, toData } from './custom'
import type { PaletteKey } from './custom'
import { contrast, parseHex } from './colors'

const current = atom({ plugin: 'persona', key: 'current' } as const, DEFAULT_SKIN)
const isBandHidden = atom({ plugin: 'persona', key: 'isBandHidden' } as const, false)
// The band shows once per session: from session start until the first message is sent.
const isBandShown = atom({ plugin: 'persona', key: 'isBandShown' } as const, false)
const isMotionOff = atom({ plugin: 'persona', key: 'isMotionOff' } as const, false)
const isRepliesOff = atom({ plugin: 'persona', key: 'isRepliesOff' } as const, false)
const hovered = atom({ plugin: 'persona', key: 'hovered' } as const, '')
// Change the tag when a persona's fields change: it declines what an older version stored.
// Each area can follow its own persona; '' follows the main one.
type Area = 'terminal' | 'chat' | 'panels'
const AREAS: Area[] = ['terminal', 'chat', 'panels']
const AREA_LABEL: Record<Area, string> = {
  terminal: 'terminal colours',
  chat: 'chat (replies, tool rows, band)',
  panels: 'panels (operator board, other mods)',
}
const NO_OVERRIDE: Record<Area, string> = { terminal: '', chat: '', panels: '' }
const areaOverride = atom({ plugin: 'persona', key: 'areaOverride' } as const, NO_OVERRIDE, { shape: 'areas-1' })
// The picker's second step: the persona picked, waiting for where to apply it ('' on step one).
const pickChosen = atom({ plugin: 'persona', key: 'pickChosen' } as const, '')
const customs = atom({ plugin: 'persona', key: 'customs' } as const, [] as Skin[], { shape: 'customs-1' })

const PICK = { id: 'persona-pick', title: 'Pick a persona' }

const RESULT_LINES = 10
/** Printable text: ANSI codes and control characters out, tabs as spaces. */
const clean = (s: string): string =>
  s
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)/g, '')
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f]/g, '')

const pick = (words: string[]): string => words[Math.floor(Math.random() * words.length)] ?? words[0] ?? ''
const titleCase = (name: string) => name.split('-').map(w => (w[0] ?? '').toUpperCase() + w.slice(1)).join(' ')

async function allPersonas($: EngineInterface): Promise<Skin[]> {
  return [...SKINS, ...(await read($, customs))]
}

async function findAny($: EngineInterface, name: string): Promise<Skin | undefined> {
  const n = name.trim().toLowerCase()
  return (await allPersonas($)).find(s => s.name === n || s.label.toLowerCase() === n)
}

async function personaNow($: EngineInterface): Promise<Skin> {
  return (await findAny($, await read($, current))) ?? findSkin(DEFAULT_SKIN) ?? SKINS[0]!
}

/** The persona an area follows: its own pick, else the main persona. */
async function personaFor($: EngineInterface, area: Area): Promise<Skin> {
  const own = (await read($, areaOverride))[area]
  return (own ? await findAny($, own) : undefined) ?? (await personaNow($))
}

/** Applies a persona to every area ('all') or to one area only. */
async function applyTo($: EngineInterface, skin: Skin, scope: Area | 'all', terminalOn: boolean): Promise<string> {
  if (scope === 'all') {
    await update($, current, () => skin.name)
    await $.store.set('current', skin.name)
    await update($, areaOverride, () => NO_OVERRIDE)
    await $.store.set('areaOverride', NO_OVERRIDE)
  } else {
    let next_: Record<Area, string> = NO_OVERRIDE
    await update($, areaOverride, o => (next_ = { ...o, [scope]: skin.name }))
    await $.store.set('areaOverride', next_)
  }
  if (scope === 'all' || scope === 'panels') await publish($)
  if (scope === 'all' || scope === 'terminal') return paintTerminal($, await personaFor($, 'terminal'), terminalOn)
  return ''
}

/** Puts an area back on the main persona. */
async function followMain($: EngineInterface, area: Area, terminalOn: boolean): Promise<string> {
  let next_: Record<Area, string> = NO_OVERRIDE
  await update($, areaOverride, o => (next_ = { ...o, [area]: '' }))
  await $.store.set('areaOverride', next_)
  if (area === 'panels') await publish($)
  if (area === 'terminal') return paintTerminal($, await personaFor($, 'terminal'), terminalOn)
  return ''
}

async function areasText($: EngineInterface): Promise<string> {
  const o = await read($, areaOverride)
  const main = await personaNow($)
  const rows = await Promise.all(
    AREAS.map(async a => `  ${a.padEnd(9)} ${(await personaFor($, a)).label.padEnd(18)} ${o[a] ? '' : '(follows main)'}  · ${AREA_LABEL[a]}`),
  )
  return [`Main persona: ${main.label}`, ...rows, '', '/persona <name> <area> · /persona <area> follow · /persona <name> all'].join('\n')
}

/** Saves the personas made here (not the folder's, which live in their files). */
async function saveCustoms($: EngineInterface, list: Skin[]): Promise<void> {
  await update($, customs, () => list)
  await $.store.set('customs', list.filter(s => s.source === 'mine'))
}

/** Adds or replaces one of the person's personas. */
async function putCustom($: EngineInterface, skin: Skin): Promise<void> {
  const list = await read($, customs)
  await saveCustoms($, [...list.filter(s => s.name !== skin.name), { ...skin, source: 'mine' }])
}

/**
 * Publishes the active persona as the CLI theme: other local mods read this file
 * (see their hooks/look.ts) and paint their panes with it. Best effort.
 */
const ACTIVE_FILE = '.claude/persona-active.json'
async function publish($: EngineInterface): Promise<void> {
  try {
    const s = await personaFor($, 'panels')
    const home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? ''
    await $.fs.write(`${home}/${ACTIVE_FILE}`, JSON.stringify({ v: 1, name: s.name, label: s.label, palette: s.palette }, null, 2) + '\n')
  } catch {
    // a pane keeps the terminal theme when the file can't be written
  }
}

async function choose($: EngineInterface, skin: Skin, terminalOn: boolean): Promise<string> {
  return applyTo($, skin, 'all', terminalOn)
}

/** Paints the Terminal tab unless it is off; returns a note when it could not. */
async function paintTerminal($: EngineInterface, skin: Skin, terminalOn: boolean): Promise<string> {
  const stored = await $.store.get('isTerminalOff')
  if (stored === true || (stored === undefined && !terminalOn)) return ''
  try {
    return await applyTerminal($, skin.palette, skin.label)
  } catch (err) {
    return String(err)
  }
}

async function expandHome($: EngineInterface, path: string): Promise<string> {
  if (!path.startsWith('~')) return path
  return ((await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE')) ?? '') + path.slice(1)
}

/** Reads every `*.json` persona in the folder. Resolves the personas and a note per file it skipped. */
async function loadFolder($: EngineInterface, dir: string): Promise<{ list: Skin[]; problems: string[] }> {
  const list: Skin[] = []
  const problems: string[] = []
  try {
    if (!(await $.fs.exists(dir))) return { list, problems }
    for (const entry of await $.fs.list(dir)) {
      if (entry.kind !== 'file' || !entry.name.endsWith('.json')) continue
      try {
        const got = fromData(JSON.parse(await $.fs.read(`${dir}/${entry.name}`)), entry.name.replace(/\.json$/, ''))
        if (got.skin) list.push({ ...got.skin, source: 'file' })
        else problems.push(`${entry.name}: ${got.error}`)
      } catch (err) {
        problems.push(`${entry.name}: ${String(err)}`)
      }
    }
  } catch (err) {
    problems.push(String(err))
  }
  return { list, problems }
}

/** The person's own copy to edit: a built-in or a folder persona is forked as `my-<name>`. */
async function editable($: EngineInterface): Promise<Skin> {
  const now = await personaNow($)
  if (now.source === 'mine') return now
  const name = (`my-${now.name.replace(/^my-/, '')}`).slice(0, 32)
  const existing = (await read($, customs)).find(s => s.name === name)
  if (existing) return existing
  return { ...now, palette: { ...now.palette }, name, label: `My ${now.label}`, source: 'mine' }
}

function paletteText(s: Skin): string {
  return [
    `${s.label} (${s.name}${s.source === 'mine' ? ', yours' : s.source === 'file' ? ', from folder' : ''})`,
    ...PALETTE_KEYS.map(k => {
      const ratio = k === 'bg' ? '' : `  ${contrast(s.palette[k], s.palette.bg).toFixed(1)}:1`
      return `  ${k.padEnd(7)} ${s.palette[k]}${ratio.padEnd(9)} ${KEY_HELP[k]}`
    }),
    `  spinner ${s.spinner.join(', ')}`,
    `  done    ${s.done.join(', ')}`,
  ].join('\n')
}

const HELP = [
  'Persona commands:',
  '  /persona                      pick one (↑/↓ preview, Enter pick)',
  '  /persona <name>               switch everywhere',
  '  /persona <name> <area>        only for terminal | chat | panels  (or all)',
  '  /persona <area> follow        that area follows the main persona again',
  '  /persona areas                which persona each area uses',
  '  /persona list | show [name]   list all · show colours and contrast',
  '  /persona new <name> <bg> [fg] [accent …]   make one from colours',
  '  /persona new <name> from <persona>         copy one to edit',
  '  /persona set <key> <colour> [<key> <colour> …]   repaint the current one',
  '  /persona words <a, b, c>      spinner words · /persona done <a, b>  footer words',
  '  /persona label <text>         rename the current one',
  '  /persona icons <kind> <glyph> …   tool-row icons (read write run search web mcp other)',
  '  /persona frames <f> <f> …     the spinner animation',
  `  /persona scene <name|off>     the strip while Claude works (${Object.keys(SCENES).join(', ')})`,
  '  /persona motion off|on        all animation',
  '  /persona delete <name>        delete one of yours',
  '  /persona export [name]        save to the personas folder and print JSON',
  '  /persona import <file | JSON> add a persona',
  '  /persona reload               re-read the personas folder',
  '  /persona off|on               band · replies off|on · terminal off|on',
  `Keys: ${PALETTE_KEYS.join(', ')}`,
  'Or ask Claude: "make me a persona that feels like a sunset".',
].join('\n')

async function listText($: EngineInterface): Promise<string> {
  const active = await read($, current)
  const row = (s: Skin) => `${s.name === active ? '●' : ' '} ${s.name.padEnd(18)} ${s.label}`
  const mine = await read($, customs)
  return [
    'Personas (/persona <name> to switch, /persona help for more):',
    ...SKINS.map(row),
    ...(mine.length ? ['', 'Yours:', ...mine.map(row)] : []),
  ].join('\n')
}

/** Re-reads the personas folder, keeping the person's own personas first. */
async function reloadFolder($: EngineInterface, folder: string): Promise<{ dir: string; count: number; problems: string[] }> {
  const dir = await expandHome($, folder)
  const { list, problems } = await loadFolder($, dir)
  const mine = (await read($, customs)).filter(s => s.source === 'mine')
  const names = new Set(mine.map(s => s.name))
  await update($, customs, () => [...mine, ...list.filter(s => !names.has(s.name))])
  return { dir, count: list.length, problems }
}

export const register: Register = (on, options) => {
  const opt = {
    defaultPersona: String(options.defaultPersona ?? DEFAULT_SKIN),
    replies: options.replies !== false,
    terminalColors: options.terminalColors !== false,
    band: options.band !== false,
    personasDir: String(options.personasDir ?? '~/.claude/personas'),
  }
  let spinnerWord = ''

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'persona',
      description: 'Pick, switch or make a persona: how replies, tool rows and the terminal look',
      argumentHint: '[name | list | new | set | export | import | help]',
    })
    await $.tool.register({
      name: 'design',
      description:
        "Create (or update) a persona for the user's Claude Code terminal and switch to it. Use when the user asks for a persona, skin or theme with a feel (\"like a sunset\", \"cozy\", \"matches my brand #ff5a1f\"). " +
        'Give bg (terminal background) and optionally fg (text) and accents (1-6 hex, most important first; the first is the main accent). ' +
        `Optionally colors: exact hex per key (${PALETTE_KEYS.join(', ')}). Contrast is fixed automatically. ` +
        'spinner: 3-6 short -ing words in the theme; done: 2-4 past-tense words.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'lowercase-with-dashes id, e.g. "sunset"' },
          label: { type: 'string', description: 'display name, e.g. "Sunset"' },
          bg: { type: 'string' },
          fg: { type: 'string' },
          accents: { type: 'array', items: { type: 'string' } },
          colors: { type: 'object', additionalProperties: { type: 'string' } },
          spinner: { type: 'array', items: { type: 'string' } },
          done: { type: 'array', items: { type: 'string' } },
          icons: { type: 'object', description: 'tool-row glyphs by kind: read, write, run, search, web, mcp, other (1-5 chars each)', additionalProperties: { type: 'string' } },
          frames: { type: 'array', items: { type: 'string' }, description: '2-12 spinner frames, 1-5 chars each' },
          scene: {
            type: 'object',
            description: `the strip shown while Claude works: { preset?: one of ${Object.keys(SCENES).join('|')}, particles?: { glyphs, dir: up|down|left|right|drift|twinkle, speed 1-5, density 0.01-0.5, colors: palette keys or hex }, sprite?: { frames: short text art, every: ticks per frame, at: left|center|right, color } }`,
          },
        },
        required: ['name', 'bg'],
      },
      isDeferred: false,
    })

    const mine = await $.store.get('customs')
    if (Array.isArray(mine)) {
      const ok = mine.map(m => fromData(m).skin).filter((s): s is Skin => !!s).map(s => ({ ...s, source: 'mine' as const }))
      await update($, customs, () => ok)
    }
    await reloadFolder($, opt.personasDir)

    const saved = await $.store.get('current')
    const start = typeof saved === 'string' ? saved : opt.defaultPersona
    if (await findAny($, start)) await update($, current, () => start)
    const savedAreas = await $.store.get('areaOverride')
    if (savedAreas && typeof savedAreas === 'object')
      await update($, areaOverride, () => ({ ...NO_OVERRIDE, ...(savedAreas as Record<Area, string>) }))
    await publish($)
    const hidden = await $.store.get('isBandHidden')
    await update($, isBandHidden, () => (typeof hidden === 'boolean' ? hidden : !opt.band))
    const motionOff = await $.store.get('isMotionOff')
    let reduced = false
    try {
      reduced = (await $.settings.read()).prefersReducedMotion === true
    } catch {
      reduced = false
    }
    await update($, isMotionOff, () => (typeof motionOff === 'boolean' ? motionOff : reduced))
    const repliesOff = await $.store.get('isRepliesOff')
    await update($, isRepliesOff, () => (typeof repliesOff === 'boolean' ? repliesOff : !opt.replies))
    void paintTerminal($, await personaFor($, 'terminal'), opt.terminalColors).catch(() => {})

    return next(e)
  })

  on('command.run', { command: 'persona' }, async ($, e) => {
    const raw = e.args.trim()
    const [first = '', ...rest] = raw.split(/\s+/)
    const sub = first.toLowerCase()
    const tail = raw.slice(first.length).trim()
    const lower = raw.toLowerCase()

    if (sub === '') {
      await update($, hovered, () => '')
      await update($, pickChosen, () => '')
      const rows = (await allPersonas($)).length + 10
      await $.ui.open({ id: PICK.id, title: PICK.title, focus: true, closeOnEscape: true, holdToasts: true, rows })
      return { text: 'Pick a persona: ↑/↓ to move, Enter to pick, Esc to close.' }
    }
    if (sub === 'help') return { text: HELP }
    if (sub === 'areas') return { text: await areasText($) }
    if ((AREAS as string[]).includes(sub) && tail.toLowerCase() === 'follow') {
      const why = await followMain($, sub as Area, opt.terminalColors)
      return { text: `${titleCase(sub)} follows the main persona again.` + (why ? ` (terminal: ${why})` : '') }
    }
    if (sub === 'list') return { text: await listText($) }
    if (sub === 'show') {
      const s = tail ? await findAny($, tail) : await personaNow($)
      return { text: s ? paletteText(s) : `No persona called "${tail}".` }
    }
    if (lower === 'terminal off' || lower === 'terminal on') {
      const off = lower === 'terminal off'
      await $.store.set('isTerminalOff', off)
      const why = off ? await restoreTerminal($).catch(String) : await paintTerminal($, await personaFor($, 'terminal'), true)
      return { text: (off ? 'Terminal colours restored.' : 'Terminal painted in the persona.') + (why ? ` (${why})` : '') }
    }
    if (lower === 'replies off' || lower === 'replies on') {
      const off = lower === 'replies off'
      await update($, isRepliesOff, () => off)
      await $.store.set('isRepliesOff', off)
      return { text: off ? 'Replies drawn by Claude Code again.' : 'Replies drawn in the persona.' }
    }
    if (lower === 'motion off' || lower === 'motion on') {
      const off = lower === 'motion off'
      await update($, isMotionOff, () => off)
      await $.store.set('isMotionOff', off)
      return { text: off ? 'Animations off: no scene, a still spinner.' : 'Animations on.' }
    }
    if (sub === 'icons' || sub === 'frames' || sub === 'scene') {
      const skin = await editable($)
      let next_: Skin = skin
      if (sub === 'icons') {
        if (rest.length < 2 || rest.length % 2) return { text: 'Usage: /persona icons <kind> <glyph> [<kind> <glyph> …]\nKinds: read, write, run, search, web, mcp, other' }
        const pairs: Record<string, string> = { ...(skin.icons ?? {}) }
        for (let i = 0; i < rest.length; i += 2) pairs[rest[i]!.toLowerCase()] = rest[i + 1]!
        const icons = cleanIcons(pairs)
        if (!icons) return { text: 'No usable icons: kinds are read, write, run, search, web, mcp, other; a glyph is 1-5 characters.' }
        next_ = { ...skin, icons }
      } else if (sub === 'frames') {
        const frames = cleanFrames(rest)
        if (!frames) return { text: 'Usage: /persona frames <frame> <frame> [… up to 12], each 1-5 characters' }
        next_ = { ...skin, frames }
      } else {
        const want = (rest[0] ?? '').toLowerCase()
        if (want === 'off' || want === 'none') next_ = { ...skin, scene: { preset: 'none' } }
        else if (SCENES[want]) next_ = { ...skin, scene: { ...(skin.scene ?? {}), preset: want, particles: undefined } }
        else return { text: `Scenes: ${Object.keys(SCENES).join(', ')}, off. For your own, ask Claude or edit the persona JSON (scene.particles, scene.sprite).` }
      }
      await putCustom($, next_)
      await choose($, next_, opt.terminalColors)
      return { text: `Updated "${next_.name}" ${sub}.` + (isBuiltIn(skin.name) ? '' : '') }
    }
    if (lower === 'off' || lower === 'on') {
      const hide = lower === 'off'
      await update($, isBandHidden, () => hide)
      await $.store.set('isBandHidden', hide)
      return { text: hide ? 'Persona band hidden.' : 'Persona band shown.' }
    }

    if (sub === 'new') {
      const name = (rest[0] ?? '').toLowerCase()
      if (!NAME_RE.test(name)) return { text: 'Usage: /persona new <name> <bg> [fg] [accent …]  (name: a-z, 0-9, dashes)' }
      if (isBuiltIn(name)) return { text: `"${name}" is a built-in persona; pick another name.` }
      let skin: Skin
      let notes: string[] = []
      if ((rest[1] ?? '').toLowerCase() === 'from') {
        const base = await findAny($, rest.slice(2).join(' '))
        if (!base) return { text: `No persona called "${rest.slice(2).join(' ')}" to copy.` }
        skin = { ...base, palette: { ...base.palette }, name, label: titleCase(name), source: 'mine' }
      } else {
        const hexes = rest.slice(1).map(parseHex)
        const bad = rest.slice(1).filter((_, i) => !hexes[i])
        if (bad.length) return { text: `Not colours: ${bad.join(', ')}. Use hex like #1a1b26.` }
        const [bg, fg, ...accents] = hexes as string[]
        if (!bg) return { text: 'Give at least a background colour: /persona new <name> <bg> [fg] [accent …]' }
        const built = buildPalette(bg, fg, accents)
        notes = built.notes
        skin = { name, label: titleCase(name), palette: built.palette, spinner: ['Thinking', 'Working', 'Composing'], done: ['Done', 'Finished'], source: 'mine' }
      }
      await putCustom($, skin)
      const why = await choose($, skin, opt.terminalColors)
      return {
        text: [
          `Made persona "${skin.name}" and switched to it.`,
          ...(notes.length ? ['Adjusted for readability:', ...notes.map(n => `  ${n}`)] : []),
          `Tweak it: /persona set <key> <colour> · /persona words … · /persona show`,
          ...(why ? [`(terminal: ${why})`] : []),
        ].join('\n'),
      }
    }

    if (sub === 'set') {
      if (rest.length < 2 || rest.length % 2) return { text: `Usage: /persona set <key> <colour> [<key> <colour> …]\nKeys: ${PALETTE_KEYS.join(', ')}` }
      const skin = await editable($)
      const palette = { ...skin.palette }
      for (let i = 0; i < rest.length; i += 2) {
        const key = rest[i]!.toLowerCase() as PaletteKey
        const hex = parseHex(rest[i + 1]!)
        if (!PALETTE_KEYS.includes(key)) return { text: `No key "${rest[i]}". Keys: ${PALETTE_KEYS.join(', ')}` }
        if (!hex) return { text: `"${rest[i + 1]}" is not a colour. Use hex like #1a1b26.` }
        palette[key] = hex
      }
      const fixed = readable(palette)
      const next = { ...skin, palette: fixed.palette }
      await putCustom($, next)
      const why = await choose($, next, opt.terminalColors)
      return {
        text: [
          `Updated "${next.name}".`,
          ...(fixed.notes.length ? ['Adjusted for readability:', ...fixed.notes.map(n => `  ${n}`)] : []),
          ...(why ? [`(terminal: ${why})`] : []),
        ].join('\n'),
      }
    }

    if (sub === 'words' || sub === 'done' || sub === 'label') {
      if (!tail) return { text: sub === 'label' ? 'Usage: /persona label <text>' : `Usage: /persona ${sub} <word>, <word>, …` }
      const skin = await editable($)
      const words = tail.split(',').map(w => w.trim()).filter(w => w && w.length <= 24).slice(0, 12)
      const next =
        sub === 'label' ? { ...skin, label: tail.slice(0, 40) }
          : sub === 'words' ? { ...skin, spinner: words.length ? words : skin.spinner }
          : { ...skin, done: words.length ? words : skin.done }
      await putCustom($, next)
      await choose($, next, opt.terminalColors)
      return { text: `Updated "${next.name}".` }
    }

    if (sub === 'delete') {
      const name = tail.toLowerCase()
      const list = await read($, customs)
      const target = list.find(s => s.name === name)
      if (!target) return { text: isBuiltIn(name) ? 'Built-in personas can’t be deleted.' : `None of yours is called "${name}".` }
      if (target.source === 'file') return { text: `"${name}" comes from a file in ${opt.personasDir}; delete the file and run /persona reload.` }
      await saveCustoms($, list.filter(s => s.name !== name))
      if ((await read($, current)) === name) await choose($, findSkin(opt.defaultPersona) ?? SKINS[0]!, opt.terminalColors)
      return { text: `Deleted "${name}".` }
    }

    if (sub === 'export') {
      const s = tail ? await findAny($, tail) : await personaNow($)
      if (!s) return { text: `No persona called "${tail}".` }
      const json = JSON.stringify(toData(s), null, 2)
      const dir = await expandHome($, opt.personasDir)
      let where = ''
      try {
        await $.fs.write(`${dir}/${s.name}.json`, json + '\n')
        where = `Saved to ${dir}/${s.name}.json`
      } catch (err) {
        where = `Could not save to ${dir}: ${String(err)}`
      }
      return { text: `${where}\nShare the file, or paste this into /persona import:\n${JSON.stringify(toData(s))}` }
    }

    if (sub === 'import') {
      if (!tail) return { text: 'Usage: /persona import <path to .json | JSON text>' }
      let data: unknown
      try {
        data = tail.startsWith('{') ? JSON.parse(tail) : JSON.parse(await $.fs.read(await expandHome($, tail)))
      } catch (err) {
        return { text: `Could not read that persona: ${String(err)}` }
      }
      const got = fromData(data)
      if (!got.skin) return { text: `Not imported: ${got.error}` }
      await putCustom($, got.skin)
      const why = await choose($, got.skin, opt.terminalColors)
      return {
        text: [
          `Imported "${got.skin.name}" and switched to it.`,
          ...(got.notes.length ? ['Adjusted for readability:', ...got.notes.map(n => `  ${n}`)] : []),
          ...(why ? [`(terminal: ${why})`] : []),
        ].join('\n'),
      }
    }

    if (sub === 'reload') {
      const r = await reloadFolder($, opt.personasDir)
      await publish($)
      return { text: [`Loaded ${r.count} persona file(s) from ${r.dir}.`, ...r.problems.map(p => `  skipped ${p}`)].join('\n') }
    }

    const words = raw.split(/\s+/)
    const lastWord = (words[words.length - 1] ?? '').toLowerCase()
    if (words.length > 1 && (lastWord === 'all' || (AREAS as string[]).includes(lastWord))) {
      const named = await findAny($, words.slice(0, -1).join(' '))
      if (named) {
        const why = await applyTo($, named, lastWord as Area | 'all', opt.terminalColors)
        const where = lastWord === 'all' ? 'everywhere' : AREA_LABEL[lastWord as Area]
        return { text: `Persona ${named.label} for ${where}.` + (why ? ` (terminal: ${why})` : '') }
      }
    }
    const skin = await findAny($, raw)
    if (!skin) return { text: `No persona called "${raw}".\n\n${await listText($)}\n\n/persona help for every command.` }
    const why = await choose($, skin, opt.terminalColors)
    return { text: `Persona: ${skin.label}` + (why ? ` (terminal: ${why})` : '') }
  })

  // The design tool: Claude makes a persona from a description and switches to it.
  on('tool.call', { tool: /^mcp__persona__design$/ }, async ($, e) => {
    const input = e as unknown as {
      name?: string; label?: string; bg?: string; fg?: string; accents?: string[]
      colors?: Record<string, string>; spinner?: string[]; done?: string[]
      icons?: Record<string, string>; frames?: string[]; scene?: unknown
    }
    const name = String(input.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32)
    const accents = (input.accents ?? []).map(String)
    const palette: Record<string, string> = { ...(input.colors ?? {}), bg: String(input.bg ?? '') }
    if (input.fg) palette.fg = String(input.fg)
    const roles = ['web', 'read', 'write', 'search', 'run', 'mcp'] as const
    accents.slice(0, 6).forEach((a, i) => {
      if (!(roles[i]! in (input.colors ?? {}))) palette[roles[i]!] = a
    })
    const got = fromData({ name, label: input.label ?? titleCase(name), palette, spinner: input.spinner, done: input.done, icons: input.icons, frames: input.frames, scene: input.scene })
    if (!got.skin) return { result: `Persona not made: ${got.error}` }
    await putCustom($, got.skin)
    const why = await choose($, got.skin, opt.terminalColors)
    return {
      result: [
        `Persona "${got.skin.name}" saved and applied.`,
        paletteText(got.skin),
        ...(got.notes.length ? ['Adjusted for readability:', ...got.notes] : []),
        ...(why ? [`Terminal: ${why}`] : []),
        'The user can tweak it with /persona set <key> <colour>, or share it with /persona export.',
      ].join('\n'),
    }
  })

  on('prompt.submit', async ($, e, next) => {
    if (!e.command && !e.isMeta && e.text.trim()) await update($, isBandShown, () => true)
    try {
      spinnerWord = pick((await personaFor($, 'chat')).spinner)
    } catch {
      spinnerWord = ''
    }
    return next(e)
  })

  // Picker: moving the focus previews a persona; Enter picks it.
  on('ui.focus', { component: 'Pane', requestId: PICK.id }, async ($, e, next) => {
    const key = e.element ?? ''
    if (key.startsWith('p-')) await update($, hovered, () => key.slice(2))
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PICK.id }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const active = await read($, current)
    const mine = await read($, customs)
    const preview = (await findAny($, await read($, hovered))) ?? (await personaNow($))
    const p = preview.palette
    const o = await read($, areaOverride)
    const inUse = await Promise.all(AREAS.map(a => personaFor($, a)))
    const chosen = await findAny($, await read($, pickChosen))
    // Step one: Enter on a persona moves to step two instead of applying it.
    const onPick = (s: Skin) => update($, pickChosen, () => s.name)
    const applyAt = async (s: Skin, scope: Area | 'all') => {
      // Close first: saving, publishing and painting must never hold the picker open.
      await $.ui.close({ id: PICK.id })
      await update($, pickChosen, () => '')
      $.ui.toast(scope === 'all' ? `Persona: ${s.label}` : `Persona ${s.label} for ${AREA_LABEL[scope]}`)
      void applyTo($, s, scope, opt.terminalColors)
    }
    const nowLine = (
      <Text dimColor wrap="truncate-end">
        now: terminal {inUse[0]!.label}{o.terminal ? '' : '*'} · chat {inUse[1]!.label}{o.chat ? '' : '*'} · panels{' '}
        {inUse[2]!.label}{o.panels ? '' : '*'}  (* follows main)
      </Text>
    )
    if (chosen) {
      const c = chosen.palette
      const areaBtn = (v: Area | 'all', label: string, hint: string, focus = false) => (
        <Button key={`area-${v}`} plain {...(focus ? { autoFocus: true as const } : {})} onPress={() => applyAt(chosen, v)}>
          <Text color={c.web} bold>
            {label.padEnd(10)}
          </Text>
          <Text dimColor>{hint}</Text>
        </Button>
      )
      return (
        <Box flexDirection="column">
          <Box flexDirection="column" borderStyle="round" borderColor={c.web} paddingX={1}>
            <Text color={c.web} bold>
              Apply {chosen.label} to…
            </Text>
            <Text>
              <Text color={c.read}>■</Text>
              <Text color={c.write}>■</Text>
              <Text color={c.run}>■</Text>
              <Text color={c.search}>■</Text>
              <Text color={c.web}>■</Text>
              <Text color={c.ok}>■</Text>
              <Text color={c.err}>■</Text>
            </Text>
          </Box>
          {areaBtn('all', 'Everything', 'terminal, chat and panels', true)}
          {areaBtn('terminal', 'Terminal', AREA_LABEL.terminal)}
          {areaBtn('chat', 'Chat', AREA_LABEL.chat)}
          {areaBtn('panels', 'Panels', AREA_LABEL.panels)}
          <Button key="area-back" plain label="← back to personas" onPress={() => update($, pickChosen, () => '')} />
          {nowLine}
          <Text dimColor>↑/↓ move · Enter apply · Esc close</Text>
        </Box>
      )
    }
    const row = (s: Skin) => {
      const c = s.palette
      return (
        <Button key={`p-${s.name}`} plain {...(s.name === active ? { autoFocus: true as const } : {})} onPress={() => onPick(s)}>
          {s.name === active ? '● ' : '  '}
          <Text color={c.read}>■</Text>
          <Text color={c.write}>■</Text>
          <Text color={c.run}>■</Text>
          <Text color={c.search}>■</Text>
          <Text color={c.web}>■</Text>
          <Text color={c.ok}>■</Text>
          <Text color={c.err}>■</Text>
          {'  '}
          {s.label}
        </Button>
      )
    }
    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor={p.web} paddingX={1}>
          <Text color={p.web} bold>
            {preview.label}
          </Text>
          <Text>
            <Text color={p.read}>◇ Read</Text> <Text color={p.write}>✎ Edit</Text> <Text color={p.run}>▶ Bash</Text>{' '}
            <Text color={p.search}>⌕ Grep</Text> <Text color={p.web}>◎ Web</Text> <Text color={p.mcp}>◆ MCP</Text>
          </Text>
          <Text>
            <Text color={p.fg}>Body text</Text> <Text color={p.muted}>muted</Text> <Text color={p.ok}>✓ ok</Text>{' '}
            <Text color={p.warn}>! warn</Text> <Text color={p.err}>✗ error</Text> <Text color={p.muted}>{preview.spinner[0]}…</Text>
          </Text>
        </Box>
        {nowLine}
        {SKINS.map(row)}
        {mine.length > 0 && <Text dimColor>── yours ──</Text>}
        {mine.map(row)}
        <Text dimColor>↑/↓ preview · Enter pick, then choose where it applies · Esc close</Text>
      </Box>
    )
  })

  // /persona list and /persona show drawn with swatches.
  on('ui.render', { component: 'CommandOutput', props: { command: 'persona' } }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const sub = e.props.args.trim().split(/\s+/)[0]?.toLowerCase() ?? ''
    const { Box, Text } = $.ui.resolve(e)
    if (sub === 'show') {
      const name = e.props.args.trim().slice(4).trim()
      const s = name ? await findAny($, name) : await personaNow($)
      if (!s) return next(e)
      const p = s.palette
      return (
        <Box flexDirection="column">
          <Text bold color={p.web}>
            {s.label} <Text color={p.muted}>({s.name}{s.source === 'mine' ? ', yours' : s.source === 'file' ? ', from folder' : ''})</Text>
          </Text>
          {PALETTE_KEYS.map(k => {
            const ratio = k === 'bg' ? '' : `${contrast(p[k], p.bg).toFixed(1)}:1`
            return (
              <Text>
                <Text color={p[k]}>██ </Text>
                <Text>{k.padEnd(7)} {p[k]} </Text>
                <Text dimColor>{ratio.padEnd(7)} {KEY_HELP[k]}</Text>
              </Text>
            )
          })}
          <Text dimColor>spinner: {s.spinner.join(', ')} · done: {s.done.join(', ')}</Text>
          <Text dimColor>/persona set &lt;key&gt; &lt;colour&gt; to repaint</Text>
        </Box>
      )
    }
    if (sub !== 'list') return next(e)
    const active = await read($, current)
    const mine = await read($, customs)
    const line = (s: Skin) => {
      const p = s.palette
      const isActive = s.name === active
      return (
        <Text>
          <Text color={p.web}>{isActive ? '● ' : '  '}</Text>
          {[p.read, p.write, p.run, p.search, p.web, p.ok, p.err].map(c => (
            <Text color={c}>■</Text>
          ))}
          <Text bold={isActive}>
            {'  '}
            {s.name.padEnd(18)}
          </Text>
          <Text dimColor>{s.label}</Text>
        </Text>
      )
    }
    return (
      <Box flexDirection="column">
        <Text bold>Personas</Text>
        {SKINS.map(line)}
        {mine.length > 0 && <Text dimColor>── yours ──</Text>}
        {mine.map(line)}
        <Text dimColor>/persona &lt;name&gt; to switch · /persona new to make one · /persona help</Text>
      </Box>
    )
  })

  // Claude's replies: drawn in the persona's colours (headings, code, lists, tables, links).
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || (await read($, isRepliesOff))) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = (await personaFor($, 'chat')).palette
    const columns = (e.viewport?.columns ?? 80) - 2
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text color={p.web}>{e.props.isFirstOfReply ? '● ' : '  '}</Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {renderMarkdown({ Box, Text }, p, e.props.text, columns)}
        </Box>
      </Box>
    )
  })

  // Tool rows: a coloured icon per tool kind in front of the row.
  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const skin = await personaFor($, 'chat')
    const p = skin.palette
    const kind = kindOf(e.props.tool)
    const color = e.props.isErrored ? p.err : e.props.isRunning ? p.warn : p[kind]
    const row = await next(e)
    return (
      <Box flexDirection="row">
        <Text color={color}>{skin.icons?.[kind] ?? ICONS[kind]} </Text>
        <Box flexDirection="column" flexGrow={1}>
          {row}
        </Box>
      </Box>
    )
  })

  // Your own prompts in the transcript: the `>` and the text in the persona.
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.origin.kind !== 'composer' || (await read($, isRepliesOff))) return next(e)
    const text = clean(e.props.text)
    if (!text.trim()) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = (await personaFor($, 'chat')).palette
    return (
      <Box flexDirection="row" marginTop={1}>
        <Text color={p.web} bold>
          {'> '}
        </Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          <Text color={p.fg}>{text}</Text>
        </Box>
      </Box>
    )
  })

  // Shell output under a Bash row: stdout in the persona's text colour, stderr in its error colour.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || e.props.isErrored || e.props.tool !== 'Bash' || (await read($, isRepliesOff))) return next(e)
    const out = (e.props.output ?? {}) as { stdout?: unknown; stderr?: unknown; interrupted?: unknown }
    const stdout = typeof out.stdout === 'string' ? clean(out.stdout).replace(/\s+$/, '') : ''
    const stderr = typeof out.stderr === 'string' ? clean(out.stderr).replace(/\s+$/, '') : ''
    if (!stdout && !stderr) return next(e)
    const { Box, Text } = $.ui.resolve(e)
    const p = (await personaFor($, 'chat')).palette
    const lines = [
      ...(stdout ? stdout.split('\n').map(t => ({ t, c: p.fg })) : []),
      ...(stderr ? stderr.split('\n').map(t => ({ t, c: p.err })) : []),
    ]
    const max = e.props.isExpanded ? lines.length : RESULT_LINES
    const shown = lines.slice(0, max)
    const hidden = lines.length - shown.length
    return (
      <Box flexDirection="row">
        <Text color={p.muted}>{'  ⎿  '}</Text>
        <Box flexDirection="column" flexGrow={1} flexShrink={1}>
          {shown.map(l => (
            <Text color={l.c}>{l.t || ' '}</Text>
          ))}
          {hidden > 0 && <Text color={p.muted}>… +{hidden} lines (ctrl+o to expand)</Text>}
          {out.interrupted === true && <Text color={p.warn}>Interrupted</Text>}
        </Box>
      </Box>
    )
  })

  // The spinner says the persona's word.
  on('ui.render', { component: 'Spinner' }, async ($, e, next) => {
    if (e.props.message !== null) return next(e)
    const skin = await personaFor($, 'chat')
    const word = spinnerWord || pick(skin.spinner)
    if (e.surface !== 'terminal' || !skin.frames || (await read($, isMotionOff))) return next({ ...e, props: { ...e.props, word } })
    const { Box, Client } = $.ui.resolve(e)
    const line = await next({ ...e, props: { ...e.props, word } })
    return (
      <Box flexDirection="row">
        <Client key="persona-spin" module="./spin.tsx" props={{ frames: skin.frames, color: skin.palette.web, ms: 120 }} />
        <Box marginLeft={1} flexGrow={1}>
          {line}
        </Box>
      </Box>
    )
  })

  // The footer line ("Baked for 3s") in the persona's words.
  on('ui.render', { component: 'TurnDuration' }, async ($, e, next) => {
    const word = pick((await personaFor($, 'chat')).done)
    return next({ ...e, props: { ...e.props, word } })
  })

  // Band above the prompt: persona name and its swatches.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    if (e.props.isWorking && e.surface === 'terminal' && !(await read($, isMotionOff))) {
      const scene = sceneProps(await personaFor($, 'chat'), 2)
      if (scene.particles || scene.sprite) {
        const { Client } = $.ui.resolve(e)
        return <Client key="persona-scene" module="./scene.tsx" props={scene} flexGrow={1} />
      }
    }
    if ((await read($, isBandHidden)) || (await read($, isBandShown))) return next(e)
    const { Text } = $.ui.resolve(e)
    const s = await personaFor($, 'chat')
    const p = s.palette
    return (
      <Text wrap="truncate">
        <Text color={p.web} bold>
          ◆ {s.label}{' '}
        </Text>
        {[p.read, p.write, p.run, p.search, p.web, p.mcp, p.ok, p.warn, p.err].map(c => (
          <Text color={c}>●</Text>
        ))}
        <Text color={p.muted}> /persona to switch</Text>
      </Text>
    )
  })
}
