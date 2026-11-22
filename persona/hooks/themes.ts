import type { Palette, Persona, PersonaScene } from '../types'

export type { Palette }
export type Skin = Persona

export const SKINS: Skin[] = [
  { name: 'tokyo-night', label: 'Tokyo Night',
    palette: { read: '#7dcfff', write: '#ff9e64', run: '#e0af68', search: '#bb9af7', web: '#7aa2f7', mcp: '#73daca', other: '#a9b1d6', fg: '#c0caf5', muted: '#737aa2', ok: '#9ece6a', err: '#f7768e', warn: '#e0af68', bg: '#1a1b26' },
    spinner: ['Neon-ing', 'Drizzling', 'Glowing', 'Wiring', 'Night-driving'], done: ['Lit up', 'Wired', 'Shipped', 'Landed'] },
  { name: 'dracula', label: 'Dracula',
    palette: { read: '#8be9fd', write: '#ffb86c', run: '#f1fa8c', search: '#bd93f9', web: '#ff79c6', mcp: '#50fa7b', other: '#f8f8f2', fg: '#f8f8f2', muted: '#6272a4', ok: '#50fa7b', err: '#ff5555', warn: '#f1fa8c', bg: '#282a36' },
    spinner: ['Brooding', 'Haunting', 'Conjuring', 'Lurking', 'Scheming'], done: ['Risen', 'Conjured', 'Bitten', 'Vanquished'] },
  { name: 'catppuccin', label: 'Catppuccin Mocha',
    palette: { read: '#89dceb', write: '#fab387', run: '#f9e2af', search: '#cba6f7', web: '#74c7ec', mcp: '#94e2d5', other: '#bac2de', fg: '#cdd6f4', muted: '#7f849c', ok: '#a6e3a1', err: '#f38ba8', warn: '#f9e2af', bg: '#1e1e2e' },
    spinner: ['Purring', 'Napping', 'Pouncing', 'Kneading', 'Stretching'], done: ['Pounced', 'Purred', 'Napped', 'Curled up'] },
  { name: 'rose-pine', label: 'Rosé Pine',
    palette: { read: '#9ccfd8', write: '#ebbcba', run: '#f6c177', search: '#c4a7e7', web: '#3e8fb0', mcp: '#31748f', other: '#908caa', fg: '#e0def4', muted: '#6e6a86', ok: '#9ccfd8', err: '#eb6f92', warn: '#f6c177', bg: '#191724' },
    spinner: ['Blooming', 'Pruning', 'Steeping', 'Petaling', 'Climbing'], done: ['Bloomed', 'Pruned', 'Steeped', 'Planted'] },
  { name: 'nord', label: 'Nord',
    palette: { read: '#8fbcbb', write: '#d08770', run: '#ebcb8b', search: '#b48ead', web: '#5e81ac', mcp: '#88c0d0', other: '#d8dee9', fg: '#e5e9f0', muted: '#7b88a1', ok: '#a3be8c', err: '#bf616a', warn: '#ebcb8b', bg: '#2e3440' },
    spinner: ['Drifting', 'Frosting', 'Chilling', 'Thawing', 'Gliding'], done: ['Frozen', 'Thawed', 'Charted', 'Crossed'] },
  { name: 'gruvbox', label: 'Gruvbox',
    palette: { read: '#83a598', write: '#fe8019', run: '#b8bb26', search: '#d3869b', web: '#8ec07c', mcp: '#fabd2f', other: '#ebdbb2', fg: '#ebdbb2', muted: '#928374', ok: '#b8bb26', err: '#fb4934', warn: '#fe8019', bg: '#282828' },
    spinner: ['Brewing', 'Roasting', 'Simmering', 'Toasting', 'Kindling'], done: ['Brewed', 'Roasted', 'Toasted', 'Served'] },
  { name: 'kanagawa', label: 'Kanagawa',
    palette: { read: '#7fb4ca', write: '#ffa066', run: '#e6c384', search: '#957fb8', web: '#7e9cd8', mcp: '#7aa89f', other: '#c8c093', fg: '#dcd7ba', muted: '#727169', ok: '#98bb6c', err: '#e46876', warn: '#e6c384', bg: '#1f1f28' },
    spinner: ['Cresting', 'Inking', 'Brushing', 'Swelling', 'Ebbing'], done: ['Crested', 'Inked', 'Brushed', 'Broken'] },
  { name: 'everforest', label: 'Everforest',
    palette: { read: '#7fbbb3', write: '#e69875', run: '#dbbc7f', search: '#d699b6', web: '#83c092', mcp: '#83c092', other: '#9da9a0', fg: '#d3c6aa', muted: '#859289', ok: '#a7c080', err: '#e67e80', warn: '#dbbc7f', bg: '#2d353b' },
    spinner: ['Foraging', 'Rooting', 'Sprouting', 'Hiking', 'Branching'], done: ['Grown', 'Rooted', 'Foraged', 'Camped'] },
  { name: 'one-dark', label: 'One Dark',
    palette: { read: '#56b6c2', write: '#d19a66', run: '#e5c07b', search: '#c678dd', web: '#61afef', mcp: '#56b6c2', other: '#abb2bf', fg: '#abb2bf', muted: '#5c6370', ok: '#98c379', err: '#e06c75', warn: '#e5c07b', bg: '#282c34' },
    spinner: ['Compiling', 'Linting', 'Bundling', 'Indexing', 'Parsing'], done: ['Built', 'Linted', 'Bundled', 'Indexed'] },
  { name: 'solarized-dark', label: 'Solarized Dark',
    palette: { read: '#2aa198', write: '#d67349', run: '#b58900', search: '#8488cd', web: '#3794d6', mcp: '#2aa198', other: '#93a1a1', fg: '#93a1a1', muted: '#657b83', ok: '#859900', err: '#e56765', warn: '#b58900', bg: '#002b36' },
    spinner: ['Calibrating', 'Balancing', 'Measuring', 'Orbiting'], done: ['Balanced', 'Measured', 'Aligned'] },
  { name: 'monokai', label: 'Monokai',
    palette: { read: '#66d9ef', write: '#fd971f', run: '#e6db74', search: '#ae81ff', web: '#fa4989', mcp: '#a6e22e', other: '#f8f8f2', fg: '#f8f8f2', muted: '#75715e', ok: '#a6e22e', err: '#fa4989', warn: '#e6db74', bg: '#272822' },
    spinner: ['Hacking', 'Riffing', 'Jamming', 'Tinkering'], done: ['Hacked', 'Nailed', 'Jammed'] },
  { name: 'github-dark', label: 'GitHub Dark',
    palette: { read: '#79c0ff', write: '#ffa657', run: '#e3b341', search: '#d2a8ff', web: '#58a6ff', mcp: '#56d4dd', other: '#c9d1d9', fg: '#c9d1d9', muted: '#8b949e', ok: '#3fb950', err: '#f85149', warn: '#d29922', bg: '#0d1117' },
    spinner: ['Committing', 'Rebasing', 'Pushing', 'Reviewing', 'Merging'], done: ['Merged', 'Pushed', 'Approved', 'Shipped'] },
  { name: 'ayu-mirage', label: 'Ayu Mirage',
    palette: { read: '#95e6cb', write: '#ffa759', run: '#ffd580', search: '#d4bfff', web: '#73d0ff', mcp: '#95e6cb', other: '#cbccc6', fg: '#cbccc6', muted: '#707a8c', ok: '#bae67e', err: '#f28779', warn: '#ffd580', bg: '#1f2430' },
    spinner: ['Shimmering', 'Hovering', 'Wavering', 'Glinting'], done: ['Shimmered', 'Revealed', 'Cleared'] },
  { name: 'night-owl', label: 'Night Owl',
    palette: { read: '#7fdbca', write: '#f78c6c', run: '#ecc48d', search: '#c792ea', web: '#82aaff', mcp: '#addb67', other: '#d6deeb', fg: '#d6deeb', muted: '#7e8ea6', ok: '#addb67', err: '#ef5350', warn: '#ecc48d', bg: '#011627' },
    spinner: ['Hooting', 'Watching', 'Swooping', 'Perching', 'Prowling'], done: ['Spotted', 'Swooped', 'Perched'] },
  { name: 'palenight', label: 'Palenight',
    palette: { read: '#89ddff', write: '#f78c6c', run: '#ffcb6b', search: '#c792ea', web: '#82aaff', mcp: '#c3e88d', other: '#a6accd', fg: '#a6accd', muted: '#7a809c', ok: '#c3e88d', err: '#ff5a76', warn: '#ffcb6b', bg: '#292d3e' },
    spinner: ['Dreaming', 'Drifting', 'Wandering', 'Musing'], done: ['Dreamt', 'Mused', 'Arrived'] },
  { name: 'synthwave', label: 'Synthwave',
    palette: { read: '#36f9f6', write: '#ff8b39', run: '#fede5d', search: '#ff7edb', web: '#f97e72', mcp: '#72f1b8', other: '#e0d9f0', fg: '#f0eaff', muted: '#8c84a8', ok: '#72f1b8', err: '#fe4854', warn: '#fede5d', bg: '#262335' },
    spinner: ['Synthing', 'Cruising', 'Pulsing', 'Grooving', 'Racing'], done: ['Synced', 'Cruised', 'Peaked', 'Faded out'] },
  { name: 'horizon', label: 'Horizon',
    palette: { read: '#25b0bc', write: '#fab795', run: '#fac29a', search: '#b877db', web: '#e95678', mcp: '#29d398', other: '#d5d8da', fg: '#d5d8da', muted: '#8a8d93', ok: '#29d398', err: '#e95678', warn: '#fab795', bg: '#1c1e26' },
    spinner: ['Rising', 'Setting', 'Warming', 'Dawning'], done: ['Risen', 'Set', 'Dawned'] },
  { name: 'cobalt', label: 'Cobalt',
    palette: { read: '#9effff', write: '#ff9d00', run: '#ffc600', search: '#fb94ff', web: '#3ad900', mcp: '#80ffbb', other: '#e1efff', fg: '#ffffff', muted: '#a0b4d0', ok: '#3ad900', err: '#ff658e', warn: '#ffc600', bg: '#193549' },
    spinner: ['Diving', 'Sounding', 'Charting', 'Surfacing'], done: ['Surfaced', 'Charted', 'Docked'] },
  { name: 'iceberg', label: 'Iceberg',
    palette: { read: '#89b8c2', write: '#e2a478', run: '#e2a478', search: '#a093c7', web: '#84a0c6', mcp: '#b4be82', other: '#c6c8d1', fg: '#c6c8d1', muted: '#7a7f99', ok: '#b4be82', err: '#e27878', warn: '#e2a478', bg: '#161821' },
    spinner: ['Calving', 'Floating', 'Chilling', 'Cracking'], done: ['Calved', 'Frozen', 'Settled'] },
  { name: 'ember', label: 'Ember',
    palette: { read: '#f6c177', write: '#ff7a45', run: '#ffb454', search: '#e58fb3', web: '#ff9e64', mcp: '#d4b483', other: '#e8d5c4', fg: '#efe1d3', muted: '#9a8478', ok: '#b8cc6e', err: '#ff5f56', warn: '#ffb454', bg: '#1c1412' },
    spinner: ['Smouldering', 'Stoking', 'Crackling', 'Glowing', 'Forging'], done: ['Forged', 'Stoked', 'Tempered'] },
  { name: 'deep-forest', label: 'Deep Forest',
    palette: { read: '#8ccfb9', write: '#e0a96d', run: '#d8c477', search: '#b49fd6', web: '#6fcf97', mcp: '#9bd4a4', other: '#cfd8c8', fg: '#dce5d4', muted: '#81907f', ok: '#8fd18a', err: '#e57c74', warn: '#d8c477', bg: '#111a15' },
    spinner: ['Growing', 'Rustling', 'Mossing', 'Canopying'], done: ['Grown', 'Rooted', 'Leafed'] },
  { name: 'solarized-light', label: 'Solarized Light',
    palette: { read: '#217e77', write: '#c34815', run: '#8d6b00', search: '#666ab8', web: '#2075b0', mcp: '#217e77', other: '#586e75', fg: '#586e75', muted: '#809193', ok: '#687700', err: '#d3302d', warn: '#8d6b00', bg: '#fdf6e3' },
    spinner: ['Calibrating', 'Balancing', 'Measuring', 'Basking'], done: ['Balanced', 'Measured', 'Aligned'] },
  { name: 'paper', label: 'Paper (light)',
    palette: { read: '#0e7490', write: '#c2410c', run: '#a16207', search: '#7c3aed', web: '#1d4ed8', mcp: '#047857', other: '#374151', fg: '#1f2937', muted: '#6b7280', ok: '#15803d', err: '#b91c1c', warn: '#a16207', bg: '#fafaf7' },
    spinner: ['Writing', 'Drafting', 'Sketching', 'Noting'], done: ['Written', 'Drafted', 'Filed'] },
  { name: 'noir', label: 'Noir',
    palette: { read: '#ededed', write: '#ededed', run: '#ededed', search: '#ededed', web: '#ededed', mcp: '#ededed', other: '#ededed', fg: '#ededed', muted: '#8c8c8c', ok: '#ededed', err: '#f87171', warn: '#a3a3a3', bg: '#0a0a0a' },
    spinner: ['Thinking', 'Working', 'Composing', 'Weighing'], done: ['Done', 'Finished', 'Settled'] },
]

export const DEFAULT_SKIN = 'tokyo-night'

/** Starting points for a scene: `/persona scene <name>`, or `scene.preset` in a persona. */
export const SCENES: Record<string, PersonaScene> = {
  rain: { particles: { glyphs: ['│', '╎', '¦', '.'], dir: 'down', speed: 5, density: 0.06, colors: ['read', 'web', 'muted'] } },
  snow: { particles: { glyphs: ['*', '·', '❄', '˚'], dir: 'down', speed: 2, density: 0.05, colors: ['fg', 'read', 'muted'] } },
  sparks: { particles: { glyphs: ['*', '˙', '·', '✦'], dir: 'up', speed: 4, density: 0.06, colors: ['warn', 'write', 'err'] } },
  stars: { particles: { glyphs: ['✦', '·', '*', '˚', '+'], dir: 'twinkle', speed: 1, density: 0.05, colors: ['fg', 'run', 'search'] } },
  fireflies: { particles: { glyphs: ['•', '·', '∙'], dir: 'drift', speed: 2, density: 0.03, colors: ['run', 'ok', 'warn'] } },
  waves: { particles: { glyphs: ['~', '∼', '≈', '˜'], dir: 'left', speed: 3, density: 0.2, colors: ['web', 'read', 'muted'] } },
  bubbles: { particles: { glyphs: ['o', '°', '∘', 'O'], dir: 'up', speed: 2, density: 0.04, colors: ['read', 'mcp', 'muted'] } },
  grid: { particles: { glyphs: ['╳', '┼', '·', '═'], dir: 'left', speed: 4, density: 0.1, colors: ['search', 'web', 'read'] } },
  leaves: { particles: { glyphs: ['❦', '❧', '✿', '·'], dir: 'drift', speed: 2, density: 0.03, colors: ['ok', 'write', 'run'] } },
  drift: { particles: { glyphs: ['·', '∙', '˙'], dir: 'drift', speed: 1, density: 0.03, colors: ['web', 'muted'] } },
}

type Look = Pick<Persona, 'icons' | 'frames' | 'scene'>
const SPRITE = (frames: string[], color: string, at: 'left' | 'center' | 'right' = 'right', every = 8) => ({ frames, every, at, color })

/** Each built-in persona's own icons, spinner frames and scene. */
const LOOKS: Record<string, Look> = {
  'tokyo-night': { icons: { read: '◈', write: '✎', run: '❯', search: '⌕', web: '◉', mcp: '⬢' }, frames: ['▖', '▘', '▝', '▗'], scene: { preset: 'rain' } },
  dracula: { icons: { read: '☽', write: '✠', run: '†', search: '⊙', web: '✧', mcp: '♰' }, frames: ['◐', '◓', '◑', '◒'],
    scene: { preset: 'stars', sprite: SPRITE(['^v^', '-v-', '^v^', '^w^'], 'search') } },
  catppuccin: { icons: { read: '◇', write: '✐', run: '▸', search: '⌕', web: '♡', mcp: '❖' }, frames: ['=^.^=', '=^-^=', '=^.^=', '=^o^='],
    scene: { preset: 'bubbles', sprite: SPRITE(['ᓚᘏᗢ', 'ᓚᘏᗢ', 'ᓚᘏᗢ.'], 'write', 'right', 10) } },
  'rose-pine': { icons: { read: '❀', write: '✿', run: '›', search: '⚘', web: '❁', mcp: '✾' }, frames: ['❀', '✿', '❁', '✾'], scene: { preset: 'leaves' } },
  nord: { icons: { read: '❄', write: '✎', run: '›', search: '⌕', web: '✻', mcp: '❅' }, frames: ['❄', '❅', '❆', '❅'], scene: { preset: 'snow' } },
  gruvbox: { icons: { read: '◆', write: '✎', run: '▶', search: '⌕', web: '☕', mcp: '◈' }, frames: ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'],
    scene: { preset: 'drift', sprite: SPRITE(['c[_]', 'c[_]~', 'c[_]≈'], 'write') } },
  kanagawa: { icons: { read: '〜', write: '筆', run: '›', search: '⌕', web: '◎', mcp: '◇' }, frames: ['∼', '≈', '≋', '≈'], scene: { preset: 'waves' } },
  everforest: { icons: { read: '❦', write: '✎', run: '›', search: '⌕', web: '♣', mcp: '❧' }, frames: ['⠁', '⠂', '⠄', '⡀', '⢀', '⠠', '⠐', '⠈'], scene: { preset: 'leaves' } },
  'one-dark': { icons: { read: '⧉', write: '✎', run: '❯', search: '⌕', web: '⊕', mcp: '⬡' }, frames: ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'], scene: { preset: 'grid' } },
  'solarized-dark': { icons: { read: '☉', write: '✎', run: '›', search: '⌕', web: '☀', mcp: '◎' }, frames: ['◜', '◝', '◞', '◟'], scene: { preset: 'drift' } },
  monokai: { icons: { read: '▣', write: '✎', run: '»', search: '⌕', web: '◆', mcp: '▲' }, frames: ['▁', '▃', '▅', '▇', '▅', '▃'], scene: { preset: 'sparks' } },
  'github-dark': { icons: { read: '⎘', write: '±', run: '$', search: '⌕', web: '⊛', mcp: '⬢' }, frames: ['○', '◔', '◑', '◕', '●'],
    scene: { preset: 'drift', sprite: SPRITE(['●─●─●', '●─●─○', '●─○─○', '○─○─○'], 'ok') } },
  'ayu-mirage': { icons: { read: '◇', write: '✎', run: '›', search: '⌕', web: '◌', mcp: '◈' }, frames: ['◌', '○', '◎', '●', '◎', '○'], scene: { preset: 'drift' } },
  'night-owl': { icons: { read: '◉', write: '✎', run: '›', search: '⌕', web: '☾', mcp: '✦' }, frames: ['(o,o)', '(o,o)', '(-,-)', '(o,o)'],
    scene: { preset: 'stars', sprite: SPRITE(['(o,o)', '(o,o)', '(o,o)', '(-,-)'], 'run', 'right', 6) } },
  palenight: { icons: { read: '◇', write: '✎', run: '›', search: '⌕', web: '☾', mcp: '❖' }, frames: ['☾', '☽', '☾', '◯'], scene: { preset: 'stars' } },
  synthwave: { icons: { read: '◈', write: '✎', run: '▶', search: '⌕', web: '☀', mcp: '▲' }, frames: ['▰▱▱', '▰▰▱', '▰▰▰', '▱▰▰', '▱▱▰', '▱▱▱'],
    scene: { preset: 'grid', sprite: SPRITE(['▄██▄', '▀██▀'], 'write', 'center', 12) } },
  horizon: { icons: { read: '◇', write: '✎', run: '›', search: '⌕', web: '◒', mcp: '◈' }, frames: ['◓', '◑', '◒', '◐'], scene: { preset: 'sparks' } },
  cobalt: { icons: { read: '▸', write: '✎', run: '»', search: '⌕', web: '◉', mcp: '⬢' }, frames: ['◢', '◣', '◤', '◥'],
    scene: { preset: 'bubbles', sprite: SPRITE(['><>', '><> ', ' ><>'], 'read', 'left', 4) } },
  iceberg: { icons: { read: '△', write: '✎', run: '›', search: '⌕', web: '◬', mcp: '◇' }, frames: ['△', '▲', '△', '▵'], scene: { preset: 'snow' } },
  ember: { icons: { read: '◈', write: '✦', run: '»', search: '⌕', web: '☼', mcp: '⬢' }, frames: ['·', '∘', '○', '◎', '○', '∘'],
    scene: { preset: 'sparks', sprite: SPRITE(['▟▙', '▟▙*', '▟▙ ˙'], 'warn', 'right', 5) } },
  'deep-forest': { icons: { read: '❦', write: '✎', run: '›', search: '⌕', web: '✿', mcp: '❧' }, frames: ['•', '∙', '·', '∙'], scene: { preset: 'fireflies' } },
  'solarized-light': { icons: { read: '☉', write: '✎', run: '›', search: '⌕', web: '☀', mcp: '◎' }, frames: ['◜', '◝', '◞', '◟'], scene: { preset: 'drift' } },
  paper: { icons: { read: '▤', write: '✎', run: '›', search: '⌕', web: '✉', mcp: '❏' }, frames: ['✎', '✎.', '✎..', '✎...'], scene: { preset: 'drift' } },
  noir: { icons: { read: '·', write: '·', run: '›', search: '·', web: '·', mcp: '·' }, frames: ['.  ', '.. ', '...', ' ..', '  .', '   '], scene: { preset: 'drift' } },
}

for (const s of SKINS) Object.assign(s, LOOKS[s.name] ?? {})

/** A persona's scene as the scene module draws it: preset merged, colour keys turned into hex. */
export function sceneProps(skin: Skin, rows = 2) {
  const own = skin.scene ?? { preset: 'drift' }
  if (own.preset === 'none') return { rows, ms: 100, particles: undefined, sprite: undefined }
  const base = (own.preset && SCENES[own.preset]) || (own.particles || own.sprite ? {} : SCENES.drift!)
  const particles = own.particles ?? base.particles
  const sprite = own.sprite ?? base.sprite
  const hex = (c: string) => (c.startsWith('#') ? c : ((skin.palette as Record<string, string>)[c] ?? skin.palette.fg))
  return {
    rows,
    ms: 100,
    particles: particles ? { ...particles, colors: particles.colors.map(hex) } : undefined,
    sprite: sprite ? { ...sprite, color: hex(sprite.color) } : undefined,
  }
}

export const findSkin = (name: string): Skin | undefined => SKINS.find(s => s.name === name)

type Kind = 'read' | 'write' | 'run' | 'search' | 'web' | 'mcp' | 'other'
const KINDS: Record<string, Kind> = {
  Read: 'read', NotebookRead: 'read',
  Write: 'write', Edit: 'write', MultiEdit: 'write', NotebookEdit: 'write',
  Bash: 'run', BashOutput: 'run', PowerShell: 'run',
  Grep: 'search', Glob: 'search', LS: 'search', ToolSearch: 'search',
  WebFetch: 'web', WebSearch: 'web',
}
export const kindOf = (tool: string): Kind => (tool.startsWith('mcp__') ? 'mcp' : KINDS[tool] ?? 'other')

export const ICONS: Record<Kind, string> = { read: '◇', write: '✎', run: '▶', search: '⌕', web: '◎', mcp: '◆', other: '•' }
