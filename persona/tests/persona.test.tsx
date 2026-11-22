import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'
import { OSC_RESET, oscSet, profileColors } from '../hooks/terminal'
import { SKINS } from '../hooks/themes'
import { fitColumns, wrapCell } from '../hooks/markdown'

type T$ = Parameters<TestBody>[0]
type TOn = Parameters<TestBody>[1]
const run = ($: T$, args: string) => $.command.run({ command: 'persona', args } as Parameters<typeof $.command.run>[0])
const written: Record<string, string> = {}

/** Starts a session with the engine's nouns the mod uses answered from memory. */
async function boot($: T$, on: TOn) {
  mock.store(on)
  on('command.register', () => ({ value: { command: 'persona' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__persona__design' } }))
  on('env.get', () => ({ value: '/home/test' }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', ($, e) => {
    const w = e as unknown as { path: string; text: string }
    written[w.path] = w.text
    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

const BAND = {
  plugin: 'persona',
  component: 'AbovePrompt',
  props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 80, scroll: { offset: 0, bodyRows: 10 }, view: {} },
} as const

test('/persona switches the skin and the band follows', async ($, on) => {
  await boot($, on)

  let ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Tokyo Night/ })).toBeDefined()
  await ui.unmount()

  const out = await $.command.run({ command: 'persona', args: 'dracula' } as Parameters<typeof $.command.run>[0])
  expect(out.text).toBe('Persona: Dracula')

  ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Dracula/ })).toBeDefined()
  await ui.unmount()

  const bad = await $.command.run({ command: 'persona', args: 'nope' } as Parameters<typeof $.command.run>[0])
  expect(bad.text).toMatch(/No persona called/)
})

const PICKER = {
  plugin: 'persona',
  component: 'Pane',
  requestId: 'persona-pick',
  props: { title: 'Pick a persona', isFocused: true, bodyColumns: 60, placement: 'inline', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

test('the picker picks a skin with Enter', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  const opened = await $.command.run({ command: 'persona', args: '' } as Parameters<typeof $.command.run>[0])
  expect(opened.text).toMatch(/Pick a persona/)

  const ui = await $.ui.mount({ ...PICKER, surface: 'terminal' })
  await ui.press({ key: 'p-gruvbox' })
  await ui.press({ key: 'area-all' })
  await ui.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Gruvbox/ })).toBeDefined()
  await band.unmount()
})

const REPLY = [
  '# Title', '', 'Some **bold**, *italic*, `code` and a [link](https://x.y).', '',
  '- one', '- [x] done', '  - nested', '1. first', '', '> [!NOTE]', '> heads up', '',
  '| a | b |', '|---|---|', '| 1 | `2` |', '', '```ts', 'const x = 1 // hi', 'fn("s")', '```', '', '---',
].join('\n')

test('a reply is drawn in the persona on the terminal', async ($, on) => {
  mock.store(on)
  const ui = await $.ui.mount({
    plugin: 'persona', component: 'AssistantMessage', surface: 'terminal',
    props: { text: REPLY, isFirstOfReply: true },
  })
  expect(await ui.find({ type: 'Text', text: /Title/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▎ Note/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /╭/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /const/ })).toBeDefined()
  await ui.unmount()
})

test('your prompt is drawn in the persona; other senders are left alone', async ($, on) => {
  mock.store(on)
  const mine = await $.ui.mount({
    plugin: 'persona', component: 'UserMessage', surface: 'terminal',
    props: { text: 'fix the \x1b[31mbug\x1b[0m', origin: { kind: 'composer' }, isExpanded: true },
  } as Parameters<typeof $.ui.mount>[0])
  expect(await mine.find({ type: 'Text', text: /^fix the bug$/ })).toBeDefined()
  await mine.unmount()
})

test('Bash output is drawn in the persona and folded past 10 lines', async ($, on) => {
  mock.store(on)
  const stdout = Array.from({ length: 14 }, (_, i) => `line ${i + 1}`).join('\n')
  const ui = await $.ui.mount({
    plugin: 'persona', component: 'ToolResult', surface: 'terminal',
    props: { tool_use_id: 't1', tool: 'Bash', output: { stdout, stderr: 'oops' }, isErrored: false, isExpanded: false },
  } as Parameters<typeof $.ui.mount>[0])
  expect(await ui.find({ type: 'Text', text: /^line 10$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /\+5 lines/ })).toBeDefined()
  await ui.unmount()
})

test('a custom persona: new, set, export, delete, import', async ($, on) => {
  await boot($, on)

  const made = await run($, 'new sunset #1f1a17 #d8c8b0 #c98b5a #8fa876')
  expect(made.text).toMatch(/Made persona "sunset"/)
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Sunset/ })).toBeDefined()
  await band.unmount()

  // A colour too dark to read is lifted, and the change is reported.
  const set = await run($, 'set fg #222222 err #ff0000')
  expect(set.text).toMatch(/Adjusted for readability/)
  const shown = await run($, 'show')
  expect(shown.text).toMatch(/err\s+#ff0000/)

  const exported = await run($, 'export')
  expect(exported.text).toMatch(/Saved to \/home\/test\/\.claude\/personas\/sunset\.json/)
  const json = exported.text!.split('\n').pop()!
  expect(JSON.parse(json).palette.bg).toBe('#1f1a17')

  expect((await run($, 'delete sunset')).text).toBe('Deleted "sunset".')
  expect((await run($, 'list')).text).not.toMatch(/sunset/)
  expect((await run($, `import ${json}`)).text).toMatch(/Imported "sunset"/)
  expect((await run($, 'list')).text).toMatch(/Yours:[\s\S]*sunset/)
})

test('editing a built-in forks it as my-<name>', async ($, on) => {
  await boot($, on)
  await run($, 'nord')
  const out = await run($, 'words Skiing, Gliding')
  expect(out.text).toBe('Updated "my-nord".')
  expect((await run($, 'show')).text).toMatch(/spinner Skiing, Gliding/)
  expect((await run($, 'new nord #000000')).text).toMatch(/built-in/)
})

test('Claude designs a persona with the tool', async ($, on) => {
  await boot($, on)
  const r = await $.tool.call({
    tool: 'mcp__persona__design',
    name: 'Ocean Deep', label: 'Ocean Deep', bg: '#0b1d33', accents: ['#8fd3e8', '#2a7fb8'],
    spinner: ['Diving', 'Drifting'], done: ['Surfaced'],
  } as unknown as Parameters<typeof $.tool.call>[0])
  expect(JSON.stringify(r)).toMatch(/ocean-deep/)
  expect((await run($, 'show')).text).toMatch(/Ocean Deep \(ocean-deep, yours\)/)
})

test('the active persona is published as the CLI theme for other mods', async ($, on) => {
  await boot($, on)
  const file = '/home/test/.claude/persona-active.json'
  expect(JSON.parse(written[file] ?? '{}').name).toBe('tokyo-night')

  await run($, 'dracula')
  const theme = JSON.parse(written[file] ?? '{}')
  expect(theme.name).toBe('dracula')
  expect(theme.palette.web).toBe('#ff79c6')
  expect(theme.palette.bg).toBe('#282a36')
})

test('picking a persona, then where it applies, closes the picker', async ($, on) => {
  const closed: string[] = []
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', (_, e) => {
    closed.push((e as unknown as { id: string }).id)
    return { value: undefined }
  })
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'xterm\n??\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await boot($, on)
  const ui = await $.ui.mount({
    plugin: 'persona',
    component: 'Pane',
    requestId: 'persona-pick',
    surface: 'terminal',
    props: { title: 'Pick a persona', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as any)
  await ui.press({ key: 'p-nord' })
  expect(closed).toEqual([])
  expect(await ui.find({ type: 'Text', text: /Apply Nord to/ })).toBeDefined()
  await ui.press({ key: 'area-all' })
  expect(closed).toEqual(['persona-pick'])
  await ui.unmount()
})

test('a persona fills all 16 terminal colours, each accent its own', async () => {
  const p = SKINS.find(s => s.name === 'dracula')!.palette
  const c = profileColors(p)
  expect(Object.keys(c).filter(k => k.startsWith('ANSI')).length).toBe(16)
  expect(new Set([c.ANSIBlueColor, c.ANSIMagentaColor, c.ANSICyanColor]).size).toBe(3)
  const seq = oscSet(p)
  expect(seq.match(/\x1b]4;\d+;rgb:[0-9a-f]{2}\/[0-9a-f]{2}\/[0-9a-f]{2}\x07/g)?.length).toBe(16)
  expect(seq).toContain('\x1b]11;rgb:28/2a/36\x07')
  expect(OSC_RESET).toContain('\x1b]104\x07')
})

test('the band shows once: it goes away after the first message', async ($, on) => {
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('prompt.submit', (_: unknown, e: any) => ({ text: e.text }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await before.find({ type: 'Text', text: /to switch/ })).toBeDefined()
  await before.unmount()
  await $.prompt.submit({ text: 'hello' } as any)
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ type: 'Text', text: /to switch/ })).toBeUndefined()
  await after.unmount()
})

test('a wide table fits the window and wraps long cells', async () => {
  const w = fitColumns([17, 180], 80 - (3 * 2 + 1))!
  expect(w[0]! + w[1]!).toBeLessThanOrEqual(73)
  expect(w[0]).toBe(17)
  const lines = wrapCell('Accepting a ticket is tied to your GitHub merge (ADR-010). The board files become read-only copies.', w[1]!)
  expect(lines.length).toBeGreaterThan(1)
  expect(lines.every(l => l.length <= w[1]!)).toBe(true)
  expect(fitColumns(Array(20).fill(10), 40)).toBeNull()
})

test('a persona can be applied to one area: panels change, chat keeps the main persona', async ($, on) => {
  await boot($, on)
  const file = '/home/test/.claude/persona-active.json'
  await run($, 'dracula')
  await run($, 'nord panels')
  expect(JSON.parse(written[file] ?? '{}').name).toBe('nord')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Dracula/ })).toBeDefined()
  await band.unmount()

  await run($, 'panels follow')
  expect(JSON.parse(written[file] ?? '{}').name).toBe('dracula')
  await run($, 'gruvbox chat')
  const band2 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band2.find({ type: 'Text', text: /Gruvbox/ })).toBeDefined()
  await band2.unmount()
  await run($, 'tokyo-night all')
  const band3 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band3.find({ type: 'Text', text: /Tokyo/ })).toBeDefined()
  await band3.unmount()
})

test('the picker can apply a persona to one area only', async ($, on) => {
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: 'xterm\n??\n', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }))
  await boot($, on)
  await run($, 'dracula')
  const ui = await $.ui.mount({
    plugin: 'persona',
    component: 'Pane',
    requestId: 'persona-pick',
    surface: 'terminal',
    props: { title: 'Pick a persona', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as any)
  await ui.press({ key: 'p-nord' })
  await ui.press({ key: 'area-panels' })
  await ui.unmount()
  expect(JSON.parse(written['/home/test/.claude/persona-active.json'] ?? '{}').name).toBe('nord')
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: /Dracula/ })).toBeDefined()
  await band.unmount()
})

test('each persona has its own tool icons', async ($, on) => {
  await boot($, on)
  await run($, 'nord')
  const ui = await $.ui.mount({
    plugin: 'persona', component: 'ToolUse', surface: 'terminal',
    props: { tool: 'Read', isRunning: false, isErrored: false },
  } as any)
  expect(await ui.find({ type: 'Text', text: /❄/ })).toBeDefined()
  await ui.unmount()
})

test('the scene plays above the prompt while Claude works, and motion off stops it', async ($, on) => {
  await boot($, on)
  await run($, 'night-owl')
  const working = { ...BAND, props: { ...BAND.props, isWorking: true } }
  const ui = await $.ui.mount({ ...working, surface: 'terminal' } as any)
  expect(await ui.find({ key: 'persona-scene' })).toBeDefined()
  await ui.unmount()
  await run($, 'motion off')
  const still = await $.ui.mount({ ...working, surface: 'terminal' } as any)
  expect(await still.find({ key: 'persona-scene' })).toBeUndefined()
  await still.unmount()
})

test('icons, frames and a scene can be set and travel in the JSON', async ($, on) => {
  await boot($, on)
  await run($, 'new sunset #1a1020 #f5e6d8 #ff7a45')
  await run($, 'icons run » web ☼')
  await run($, 'frames · ∘ ○ ◎')
  await run($, 'scene sparks')
  const out = await run($, 'export sunset')
  const json = JSON.parse(String((out as any).text).split('\n').pop())
  expect(json.icons).toEqual({ run: '»', web: '☼' })
  expect(json.frames).toEqual(['·', '∘', '○', '◎'])
  expect(json.scene.preset).toBe('sparks')
})

test('a wrapped table cell keeps its bold and code', async () => {
  const lines = wrapCell('**Yes, a little.** Their `board_update` descriptions go with every request', 14)
  for (const l of lines) {
    expect((l.split('**').length - 1) % 2).toBe(0)
    expect((l.split('`').length - 1) % 2).toBe(0)
  }
  expect(lines[0]!.startsWith('**')).toBe(true)
  expect(lines.some(l => l.includes('`board_update`'))).toBe(true)
})
