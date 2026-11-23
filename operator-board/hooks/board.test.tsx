import { expect, mock, test } from 'claude-code/testing'

const pane = (id: string, title: string) =>
  ({
    plugin: 'operator-board',
    component: 'Pane',
    requestId: id,
    props: {
      title,
      isFocused: false,
      bodyColumns: 60,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 40 },
      view: {},
    },
  }) as const

let historyFixture = ''
const notified: any[] = []
const ranArgv: string[][] = []

const SECTION_KEYS = ['board', 'usage', 'git', 'sessions', 'quick', 'prs', 'recall']
/** Sections start folded: opens each one that is folded (recall stays as the test leaves it). */
async function openAll(ui: any, except: string[] = ['recall']) {
  for (const k of SECTION_KEYS) {
    if (except.includes(k)) continue
    const head = (await ui.find({ key: `sec-${k}` })) as any
    if (head && JSON.stringify(head).includes('▸')) await ui.press({ key: `sec-${k}` })
  }
}
const written: any[] = []
const submitted: string[] = []
let gitFixture: Record<string, string> | null = null
let usageFixture: any = null
let panesFixture: any[] = []
let ghFixture: ((q: string) => string) | null = null
let checksFixture: string | null = null
const closes: any[] = []

function engine(on: any, opens: any[] = []) {
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', (_: unknown, e: any) => {
    notified.push(e)
    return { value: { isSent: true, channel: 'iterm2' } }
  })
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.panes', () => ({ value: panesFixture }))
  on('ui.close', (_: unknown, e: any) => (closes.push(e), { value: undefined }))
  on('fs.write', (_: unknown, e: any) => {
    written.push(e)
    return { value: undefined }
  })
  on('command.run', () => ({ text: '' }))
  const clock = mock.clock(on, { now: 1_790_000_000_000 })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'x' } }))
  on('tool.register', () => ({ value: {} }))
  on('ui.open', (_: unknown, e: any) => {
    opens.push(e)
    return { value: { isPlaced: true } }
  })
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('session.usage', () =>
    usageFixture ? { value: usageFixture } : { deny: 'no usage in this test' },
  )
  on('process.run', (_: unknown, e: any) => (ranArgv.push(e.argv ?? []), {
    value: {
      exitCode: e.argv?.[0] === 'git' ? (gitFixture ? 0 : 128) : 0,
      stdout:
        e.argv?.[0] === 'tail'
          ? historyFixture
          : e.argv?.[0] === 'git'
            ? (gitFixture?.[e.argv[3]] ?? '')
            : String(e.argv?.[2] ?? '').includes('/check-runs')
              ? (checksFixture ?? '[]')
              : ghFixture
                ? ghFixture(String(e.argv?.find((x: string) => x.startsWith('q=')) ?? ''))
                : '{"data":{"search":{"nodes":[]}}}',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('prompt.submit', (_: unknown, e: any) => {
    if (e.origin?.kind === 'plugin') submitted.push(e.text)
    return { text: e.text }
  })
  on('turn.complete', (_: unknown, e: any) => ({ text: e.answer }))
  return clock
}

test('Claude adds a needs-reply item and the board shows it', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__operator-board__board_update',
    action: 'add',
    kind: 'reply',
    title: 'Roll out the review bot?',
    context: 'Option 1 now, option 2 wait.',
    reply: 'rollout 1',
  } as any)
  await $.tool.call({
    tool: 'mcp__operator-board__board_update',
    action: 'add',
    kind: 'pending',
    section: 'CI speedup',
    title: 'Measure the next 20 PRs',
  } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface })
    await openAll(ui)
    expect(await ui.find({ type: 'Text', text: /Roll out the review bot/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Pending – CI speedup/ })).toBeDefined()
    expect(await ui.find({ key: 'fill-r1' })).toBeDefined()
    await ui.unmount()
  }
})

test('a question and its answer can be recalled', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'is the cache rebuild finished?' } as any)
  await $.turn.complete({
    answer: 'Yes, 412 files rebuilt.',
    durationMs: 1,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
  } as any)

  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'desktop' })
  await openAll(ui)
  await ui.press({ key: 'sec-recall' })
  await ui.input({ key: 'recall-q', text: 'cache' })
  await ui.press({ key: (await ui.find({ type: 'Button', text: /cache rebuild/ }))!.key! })
  expect(await ui.find({ type: 'Text', text: /You asked/ })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: /412 files/ })).toBeDefined()
  await ui.unmount()
})

test('the board paints its headings in the active persona', async ($, on) => {
  engine(on)
  const theme = { v: 1, name: 'dracula', palette: { web: '#ff79c6', ok: '#50fa7b', err: '#ff5555', warn: '#f1fa8c', muted: '#6272a4', fg: '#f8f8f2' } }
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.stat', (_: unknown, e: any) =>
    e.path === '/home/me/.claude/persona-active.json'
      ? { value: { kind: 'file', size: 1, mtimeMs: 5, isLink: false } }
      : { deny: 'ENOENT: missing' },
  )
  on('fs.read', () => ({ value: JSON.stringify(theme) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface })
    await openAll(ui)
    const heading = (await ui.find({ type: 'Text', text: /Recent asks/ })) as any
    expect(heading?.props?.color).toBe('#ff79c6')
    await ui.unmount()
  }
})

test('with no persona the board keeps the terminal theme', async ($, on) => {
  engine(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.stat', () => ({ deny: 'ENOENT: missing' }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  const heading = (await ui.find({ type: 'Text', text: /Recent asks/ })) as any
  expect(heading?.props?.color).toBe('suggestion')
  await ui.unmount()
})

test('secondary text uses the persona muted colour', async ($, on) => {
  engine(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 1, mtimeMs: 5, isLink: false } }))
  on('fs.read', () => ({ value: JSON.stringify({ v: 1, name: 'nord', palette: { web: '#5e81ac', muted: '#7b88a1' } }) }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  const empty = (await ui.find({ type: 'Text', text: /Nothing asked yet/ })) as any
  expect(empty?.props?.color).toBe('#7b88a1')
  await ui.unmount()
})

test('the operator pane opens on session start, sized to the terminal rather than a fixed width', async ($, on) => {
  const opens: any[] = []
  engine(on, opens)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const board = opens.find(o => o.id === 'operator')
  expect(board).toBeDefined()
  expect(board.columns).toBeUndefined()
})

test('sections start folded, open when clicked, and fold again', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /Recent asks/ })).toBeDefined()
  expect(await ui.find({ key: 'pr-refresh' })).toBeDefined()
  expect(await ui.find({ key: 'sec-recall' })).toBeDefined()
  expect(await ui.find({ key: 'recall-q' })).toBeUndefined()
  await ui.press({ key: 'sec-board' })
  expect(await ui.find({ type: 'Text', text: /Recent asks/ })).toBeUndefined()
  await ui.unmount()
})

test('sessions lists earlier sessions, newest first, without this one', async ($, on) => {
  const history = [
    { display: 'fix the login bug', timestamp: 1000, project: '/work/app', sessionId: 'old' },
    { display: '/model', timestamp: 1100, project: '/work/app', sessionId: 'old' },
    { display: 'start sprint 23 planning', timestamp: 3000, project: '/work/team', sessionId: 'newer' },
    { display: 'this very session', timestamp: 4000, project: '/', sessionId: 'me' },
  ]
    .map(l => JSON.stringify(l))
    .join('\n')
  historyFixture = history
  engine(on)
  on('env.get', () => ({ value: '/home/me' }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'sessions', args: '' } as any)
  await $.command.run({ command: 'sessions', args: '' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /sprint 23/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /login bug/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /very session/ })).toBeUndefined()
  expect(await ui.find({ key: 'resume-old' })).toBeDefined()
  expect(await ui.find({ key: 'resume-newer' })).toBeUndefined()
  expect(await ui.find({ key: 'copy-newer' })).toBeDefined()
  await ui.unmount()
})

test('the board is shared: items are written to the shared file, tagged with their folder', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({
    tool: 'mcp__operator-board__board_update',
    action: 'add',
    kind: 'pending',
    section: 'CI',
    title: 'Wait for the nightly build',
  } as any)
  const last = written.filter(w => String(w.path).endsWith('.claude/operator-board/board.json')).pop()
  expect(last).toBeDefined()
  const saved = JSON.parse(last.text)
  expect(saved.items[0].title).toBe('Wait for the nightly build')
  expect(saved.items[0].project).toBe('/work/app')
})

/**
 * The shared board file in memory: reads see the last write, or what another session wrote
 * since (`otherSession`), and every write moves its mtime on.
 */
function sharedFile(on: any) {
  const file = { text: '', mtime: 0, seen: 0 }
  const isBoard = (e: any) => String(e.path).endsWith('.claude/operator-board/board.json')
  // Takes in this session's writes made since the last look.
  const sync = () => {
    const mine = written.filter(isBoard)
    if (mine.length === file.seen) return
    file.seen = mine.length
    file.text = mine[mine.length - 1].text
    file.mtime += 1
  }
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.stat', (_: unknown, e: any) => {
    sync()
    return isBoard(e) && file.text
      ? { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtime, isLink: false } }
      : { deny: 'ENOENT: missing' }
  })
  on('fs.read', (_: unknown, e: any) => {
    sync()
    return isBoard(e) && file.text ? { value: file.text } : { deny: 'ENOENT: missing' }
  })
  return {
    items: () => (sync(), file.text ? JSON.parse(file.text).items : []),
    otherSession(items: any[]) {
      sync()
      file.text = JSON.stringify({ v: 1, items })
      file.mtime += 1000
    },
  }
}

const add = (title: string, kind = 'pending') =>
  ({ tool: 'mcp__operator-board__board_update', action: 'add', kind, section: 'CI', title }) as any

test('board updates that run at once all land, each with its own id', async ($, on) => {
  written.length = 0
  engine(on)
  const board = sharedFile(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  // Claude can send several tool calls in one turn; they run together.
  await Promise.all([add('first'), add('second'), add('third'), add('ask?', 'reply')].map(c => $.tool.call(c)))
  const saved = board.items()
  expect(saved.map((i: any) => i.title).sort()).toEqual(['ask?', 'first', 'second', 'third'])
  expect(new Set(saved.map((i: any) => i.id)).size).toBe(4)
})

test('an add keeps what another session wrote to the board since the last poll', async ($, on) => {
  written.length = 0
  engine(on)
  const board = sharedFile(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call(add('mine'))
  const mine = board.items()
  board.otherSession([
    ...mine,
    { id: 'p9', kind: 'pending', section: 'CI', title: 'theirs', createdAt: 1, updatedAt: 1, project: '/work/other' },
  ])
  await $.tool.call(add('mine again'))
  await $.tool.call({ tool: 'mcp__operator-board__board_update', action: 'remove', id: mine[0].id } as any)
  expect(board.items().map((i: any) => i.title).sort()).toEqual(['mine again', 'theirs'])
})

test('the folder filter hides other folders until "all sessions" is picked', async ($, on) => {
  const shared = {
    v: 1,
    items: [
      { id: 'p1', kind: 'pending', section: 'CI', title: 'Mine here', createdAt: 1, updatedAt: 1, project: '/work/app' },
      { id: 'p2', kind: 'pending', section: 'CI', title: 'From elsewhere', createdAt: 1, updatedAt: 1, project: '/work/other' },
    ],
  }
  engine(on)
  on('env.get', () => ({ value: '/home/me' }))
  on('fs.stat', (_: unknown, e: any) =>
    String(e.path).endsWith('board.json')
      ? { value: { kind: 'file', size: 1, mtimeMs: 7, isLink: false } }
      : { deny: 'ENOENT: missing' },
  )
  on('fs.read', () => ({ value: JSON.stringify(shared) }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /Mine here/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /From elsewhere/ })).toBeUndefined()
  await ui.press({ key: 'scope-all' })
  expect(await ui.find({ type: 'Text', text: /From elsewhere/ })).toBeDefined()
  await ui.unmount()
})

test('recent asks are grouped by session, each named by its first ask', async ($, on) => {
  historyFixture = [
    { display: 'set up the login page', timestamp: 1000, project: '/work/app', sessionId: 's1' },
    { display: 'add a reset link', timestamp: 1100, project: '/work/app', sessionId: 's1' },
    { display: '/model', timestamp: 1150, project: '/work/app', sessionId: 's1' },
    { display: 'style the button', timestamp: 1200, project: '/work/app', sessionId: 's1' },
    { display: 'write the tests', timestamp: 1300, project: '/work/app', sessionId: 's1' },
  ]
    .map(l => JSON.stringify(l))
    .join('\n')
  engine(on)
  on('env.get', () => ({ value: '/home/me' }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.prompt.submit({ text: 'what is left today?' } as any)
  await $.command.run({ command: 'sessions', args: '' } as any)
  await $.command.run({ command: 'sessions', args: '' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /This session · what is left today/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /◇ set up the login page/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /write the tests/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^\s*add a reset link/ })).toBeDefined()
  await ui.unmount()
  historyFixture = ''
})

test('usage shows context and limit meters, coloured by how close they are to the stop', async ($, on) => {
  usageFixture = {
    startedAt: 1,
    context: { percent: 40, tokens: 80000, window: 200000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 92, resetsAt: new Date(1_790_000_000_000 + 4 * 3600 * 1000).toISOString() },
      { kind: 'seven_day', percentUsed: 30 },
    ],
    cost: { usd: 1.5 },
  }
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  // A new user is asked for their limits first.
  expect(await ui.find({ type: 'Text', text: /Set up usage limits/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context.*40%/ })).toBeUndefined()
  await ui.select({ key: 'limits-warn', value: '70' })
  await ui.select({ key: 'limits-stop', value: '85' })
  await ui.press({ key: 'limits-save' })
  expect(await ui.find({ key: 'limits-change', text: /70\/85/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /context.*40%/ })).toBeDefined()
  expect(await ui.find({ key: 'limits-change' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5-hour.*92%.*resets in 4h \((\w{3} )?\d\d:\d\d\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /cost this session \$1\.50/ })).toBeDefined()
  expect(written.some(w => String(w.path).endsWith('usage-log.jsonl'))).toBe(true)
  await ui.unmount()
  usageFixture = null
})

test('checkpoint_save stores a note that shows for this session', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__operator-board__checkpoint_save', note: 'Sprint 22 closed; next: plan 23' } as any)
  const saved = written.filter(w => String(w.path).endsWith('checkpoints.json')).pop()
  expect(JSON.parse(saved.text).items[0].note).toBe('Sprint 22 closed; next: plan 23')
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /this session.*Sprint 22 closed/ })).toBeDefined()
  await ui.unmount()
})

test('git shows the branch, ahead and behind, and changed files', async ($, on) => {
  gitFixture = {
    status: ['# branch.head feature/x', '# branch.upstream origin/feature/x', '# branch.ab +2 -1', '1 .M N... 100644 100644 100644 a b src/app.ts', '? notes.md'].join('\n'),
    log: 'abc1234 Add the thing (2 hours ago)',
  }
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /feature\/x.*↑2 ↓1.*2 changed/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /src\/app\.ts/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /last: abc1234/ })).toBeDefined()
  await ui.unmount()
  gitFixture = null
})

test('a pinned quick prompt shows as a button in the pane', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'quick', args: 'sorry continue' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  expect(await ui.find({ type: 'Text', text: /▸ sorry continue/ })).toBeDefined()
  const id = JSON.parse(written.filter(w => String(w.path).endsWith('quick.json')).pop().text).items[0].id
  expect(await ui.find({ key: `qfill-${id}` })).toBeDefined()
  expect(await ui.find({ key: `qdel-${id}` })).toBeDefined()
  await ui.unmount()
})

test('every section starts folded, and an opened one stays open in the next session', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Recent asks/ })).toBeUndefined()
  expect(await ui.find({ key: 'sessions-refresh' })).toBeUndefined()
  await ui.press({ key: 'sec-sessions' })
  expect(await ui.find({ key: 'sessions-refresh' })).toBeDefined()
  await ui.unmount()
  // The next session reads the remembered folds from the store.
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const again = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  expect(await again.find({ key: 'sessions-refresh' })).toBeDefined()
  expect(await again.find({ type: 'Text', text: /Recent asks/ })).toBeUndefined()
  await again.unmount()
})

const TURN = { answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any

test('to-do: your items are ready, Claude\'s wait for approval, and autopilot starts the next one', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await ui.press({ key: 'sec-todo' })
  await ui.input({ key: 'todo-add', text: 'Write the login tests' })
  await $.tool.call({ tool: 'mcp__operator-board__todo_update', action: 'add', title: 'Refactor the router' } as any)
  expect(await ui.find({ type: 'Text', text: /Write the login tests/ })).toBeDefined()
  expect(await ui.find({ key: 'tok-t2' })).toBeDefined() // Claude's item needs approval

  submitted.length = 0
  await ui.press({ key: 'todo-autopilot' })
  expect(submitted.pop()).toMatch(/Work on item t1: "Write the login tests"/)

  // Claude marks it done; the next turn end starts nothing, since t2 is only proposed.
  const done = await $.tool.call({ tool: 'mcp__operator-board__todo_update', action: 'done', id: 't1' } as any)
  expect(String((done as any).result)).toMatch(/needs a note/)
  await $.tool.call({ tool: 'mcp__operator-board__todo_update', action: 'done', id: 't1', note: 'tests pass' } as any)
  await $.turn.complete(TURN)
  expect(submitted.length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /paused: the list is done/ })).toBeDefined()

  // Approving it and turning autopilot on again starts it.
  await ui.press({ key: 'tok-t2' })
  await ui.press({ key: 'todo-autopilot' })
  expect(submitted.pop()).toMatch(/Work on item t2/)
  await ui.unmount()
})

test('to-do: autopilot pauses while a question is open', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__operator-board__board_update', action: 'add', kind: 'reply', title: 'Which DB?' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await ui.press({ key: 'sec-todo' })
  await ui.input({ key: 'todo-add', text: 'Ship it' })
  submitted.length = 0
  await ui.press({ key: 'todo-autopilot' })
  expect(submitted.length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /paused: Claude asked you something/ })).toBeDefined()
  await ui.unmount()
})

test('times can switch between 24-hour and 12-hour', async ($, on) => {
  usageFixture = {
    startedAt: 1,
    context: { percent: 10, tokens: 1000, window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 20, resetsAt: new Date(1_790_000_000_000 + 3 * 3600 * 1000).toISOString() }],
  }
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await ui.press({ key: 'sec-usage' })
  await ui.press({ key: 'limits-75-90' })
  expect(await ui.find({ type: 'Text', text: /resets in 3h \((\w{3} )?\d\d:\d\d\)/ })).toBeDefined()
  await ui.press({ key: 'time-format' })
  expect(await ui.find({ type: 'Text', text: /resets in 3h \((\w{3} )?\d{1,2}:\d\d (AM|PM)\)/ })).toBeDefined()
  await ui.unmount()
  usageFixture = null
})

test('folded headers summarise git, and git review fills the prompt', async ($, on) => {
  gitFixture = {
    status: ['# branch.head feature/x', '# branch.upstream origin/feature/x', '# branch.ab +2 -0', '? notes.md'].join('\n'),
    log: 'abc1234 Add the thing (2 hours ago)',
  }
  const fills: any[] = []
  engine(on)
  on('prompt.fill', (_: unknown, e: any) => {
    fills.push(e)
    return { isFilled: true }
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /▸ Git · feature\/x · 1 changed · ↑2/ })).toBeDefined()
  await ui.press({ key: 'sec-git' })
  await ui.press({ key: 'git-review' })
  expect(fills.at(-1)?.text).toBe('/code-review')
  await ui.unmount()
  gitFixture = null
})

test('needs reply comes before recent asks on the board', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await openAll(ui)
  const tree = JSON.stringify(await ui.find({ key: 'section-board' }))
  expect(tree.indexOf('Needs reply')).toBeLessThan(tree.indexOf('Recent asks'))
  await ui.unmount()
})

test('a turn that ends needing a reply notifies with the folder, shows on the pane, and clears when resolved', async ($, on) => {
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'mcp__operator-board__board_update', action: 'add', kind: 'reply', title: 'Ship it?' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const n = notified.find(x => /needs your reply: Ship it\?/.test(JSON.stringify(x)))
  expect(JSON.stringify(n)).toContain('Claude · app')
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Alerts \(1\)/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /needs your reply: Ship it/ })).toBeDefined()
  await $.tool.call({ tool: 'mcp__operator-board__board_update', action: 'remove', id: 'r1' } as any)
  expect(await ui.find({ type: 'Text', text: /Alerts \(/ })).toBeUndefined()
  await ui.unmount()
})

test('a section that needs you moves to the top of the pane', async ($, on) => {
  usageFixture = {
    startedAt: 1,
    context: { percent: 40, tokens: 80000, window: 200000 },
    rateLimits: [{ kind: 'five_hour', percentUsed: 95 }],
  }
  engine(on)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  const tree = JSON.stringify(await ui.find({ type: 'Box' }))
  expect(tree.indexOf('section-usage')).toBeGreaterThan(-1)
  expect(tree.indexOf('section-usage')).toBeLessThan(tree.indexOf('section-board'))
  expect(tree.indexOf('section-board')).toBeLessThan(tree.indexOf('section-todo'))
  await ui.unmount()
  usageFixture = null
})

test('the pane draws a scrollbar pinned to its window once it is taller than the window', async ($, on) => {
  engine(on)
  // The engine's part of a scroll: the window moves, nothing to answer.
  on('ui.scroll', () => ({}))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const at = (offset: number, placement = 'dock') =>
    ({
      ...pane('operator', 'operator'),
      surface: 'terminal',
      props: { ...pane('operator', 'operator').props, placement, scroll: { offset, bodyRows: 40 } },
    }) as any
  // Nothing reported yet: no bar.
  let ui = await $.ui.mount(at(0))
  expect(await ui.find({ key: 'pane-scrollbar' })).toBeUndefined()
  await ui.unmount()
  // A scroll reports 120 rows: the bar shows at the window's top, its thumb a third of it.
  await ($ as any).ui.scroll({ component: 'Pane', requestId: 'operator', offset: 30, by: 30, bodyRows: 40, contentRows: 120, origin: { kind: 'person' } })
  ui = await $.ui.mount(at(30))
  const bar = (await ui.find({ key: 'pane-scrollbar' })) as any
  expect(bar?.props.top).toBe(30)
  expect(bar?.text).toBe('│'.repeat(10) + '┃'.repeat(13) + '│'.repeat(17))
  await ui.unmount()
  // Not drawn as a desktop widget, where the surface has its own.
  ui = await $.ui.mount(at(30, 'widget'))
  expect(await ui.find({ key: 'pane-scrollbar' })).toBeUndefined()
  await ui.unmount()
  // Everything fits again: the bar goes.
  await ($ as any).ui.scroll({ component: 'Pane', requestId: 'operator', offset: 0, by: 0, bodyRows: 40, contentRows: 30, origin: { kind: 'person' } })
  ui = await $.ui.mount(at(0))
  expect(await ui.find({ key: 'pane-scrollbar' })).toBeUndefined()
  await ui.unmount()
})

test('/operator shows a pane that waits undrawn (narrow terminal) instead of closing it', async ($, on) => {
  const opens: any[] = []
  engine(on, opens)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  // Opened at session start on a narrow terminal: open, but not drawn.
  panesFixture = [{ id: 'operator', title: 'operator', isPlaced: false }]
  const before = opens.length
  const r1 = await $.command.run({ command: 'operator', args: '' } as any)
  expect(r1.text).toBe('Opened the operator pane.')
  expect(opens.length).toBe(before + 1)
  // Drawn: /operator closes it.
  panesFixture = [{ id: 'operator', title: 'operator', isPlaced: true }]
  const r2 = await $.command.run({ command: 'operator', args: '' } as any)
  expect(r2.text).toBe('Closed the operator pane.')
  expect(closes.at(-1)?.id).toBe('operator')
  panesFixture = []
})

test('the band offers to show the pane while it waits undrawn, and hides the offer once drawn', async ($, on) => {
  const opens: any[] = []
  engine(on, opens)
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const band = { plugin: 'operator-board', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any
  panesFixture = [{ id: 'operator', title: 'operator', isPlaced: false }]
  let ui = await $.ui.mount(band)
  const before = opens.length
  await ui.press({ key: 'band-show-pane' })
  expect(opens.length).toBe(before + 1)
  expect(opens.at(-1)?.id).toBe('operator')
  await ui.unmount()
  panesFixture = [{ id: 'operator', title: 'operator', isPlaced: true }]
  ui = await $.ui.mount(band)
  expect(await ui.find({ key: 'band-show-pane' })).toBeUndefined()
  expect(await ui.find({ key: 'band-board' })).toBeDefined()
  await ui.unmount()
  panesFixture = []
})

test('Git shows what Claude changed this session, and the branch\'s next step on its header', async ($, on) => {
  gitFixture = {
    status: ['# branch.head feat/x', '# branch.upstream origin/feat/x', '# branch.ab +0 -0', '1 .M N... 100644 100644 100644 a b src/a.ts'].join('\n'),
    log: 'abc1234 Start feat/x (1 hour ago)',
    remote: 'git@github.com:kg-ng/claude-mods.git\n',
    diff: '3\t1\tsrc/a.ts\n',
    'ls-files': '',
  }
  const fills: any[] = []
  engine(on)
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e), { isFilled: true }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: 'ok' }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.tool.call({ tool: 'Edit', file_path: '/work/app/src/a.ts', old_string: 'a', new_string: 'b' } as any)
  // A path outside the folder isn't this repo's change.
  await $.tool.call({ tool: 'Edit', file_path: '/elsewhere/b.ts', old_string: 'a', new_string: 'b' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  // Pushed, no PR yet: "open PR" on the folded Git header.
  await ui.press({ key: 'git-next' })
  expect(fills.at(-1)?.text).toMatch(/^Open a pull request for the branch feat\/x/)
  await ui.press({ key: 'sec-git' })
  expect(await ui.find({ type: 'Text', text: /Claude changed 1 file \+3 −1/ })).toBeDefined()
  await ui.press({ key: 'git-claude-commit' })
  expect(fills.at(-1)?.text).toBe('Commit the files Claude changed this session: src/a.ts.')
  await ui.unmount()
  gitFixture = null
})

test('PRs list the ones waiting on your review, counted on the header, with a review button', async ($, on) => {
  const node = (number: number, title: string, repo: string) => ({
    number, title, url: `https://github.com/${repo}/pull/${number}`, isDraft: false, createdAt: '2026-11-20T10:00:00Z',
    repository: { nameWithOwner: repo }, headRefOid: 'abc1234def', headRefName: 'x', reviewDecision: null,
    reviewThreads: { nodes: [] }, commits: { nodes: [] },
  })
  ghFixture = q =>
    JSON.stringify({ data: { search: { nodes: q.includes('review-requested') ? [node(9, 'Recall search', 'kg-ng/claude-mods'), node(4, 'Fix docs', 'acme/web')] : [] } } })
  gitFixture = { status: '# branch.head main', log: '', remote: 'https://github.com/kg-ng/claude-mods.git' }
  const fills: any[] = []
  engine(on)
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e), { isFilled: true }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'prs', args: '' } as any)
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /PRs \(0 · 2 to review\)/ })).toBeDefined()
  if (!JSON.stringify(await ui.find({ key: 'sec-prs' })).includes('▾')) await ui.press({ key: 'sec-prs' })
  expect(await ui.find({ type: 'Text', text: /To review \(2\)/ })).toBeDefined()
  await ui.press({ key: 'review-kg-ng/claude-mods-9' })
  expect(fills.at(-1)?.text).toBe('/code-review 9')
  await ui.press({ key: 'review-acme/web-4' })
  expect(fills.at(-1)?.text).toBe('Review acme/web#4 (https://github.com/acme/web/pull/4).')
  await ui.unmount()
  ghFixture = null
  gitFixture = null
})

test('Git: run buttons from package.json, CI on a pushed branch with no PR, and hotkeys on the headers', async ($, on) => {
  gitFixture = {
    status: ['# branch.head feat/y', '# branch.upstream origin/feat/y', '# branch.ab +0 -0'].join('\n'),
    log: 'abc1234 Try things (5 minutes ago)',
    remote: 'https://github.com/kg-ng/claude-mods.git',
  }
  checksFixture = JSON.stringify([
    { name: 'lint', status: 'completed', conclusion: 'failure' },
    { name: 'test', status: 'in_progress', conclusion: null },
    { name: 'build', status: 'completed', conclusion: 'success' },
  ])
  const fills: any[] = []
  engine(on)
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e), { isFilled: true }))
  on('fs.read', (_: unknown, e: any) =>
    String(e.path).endsWith('/package.json')
      ? { value: JSON.stringify({ scripts: { test: 'vitest', lint: 'eslint .', build: 'tsc', dev: 'vite' } }) }
      : { deny: 'ENOENT' },
  )
  on('fs.exists', (_: unknown, e: any) => ({ value: String(e.path).endsWith('/pnpm-lock.yaml') }))
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
  const focused = { ...pane('operator', 'operator'), surface: 'terminal', props: { ...pane('operator', 'operator').props, isFocused: true } } as any
  const ui = await $.ui.mount(focused)
  // The folded header names the branch's failing check; the pane has the keyboard, so digits show.
  expect(await ui.find({ type: 'Text', text: /4 ▸ Git · feat\/y · clean · CI red: lint/ })).toBeDefined()
  expect(((await ui.find({ key: 'sec-git' })) as any)?.props.hotkey).toBe('4')
  expect(((await ui.find({ key: 'sec-board' })) as any)?.props.hotkey).toBe('1')
  await ui.press({ key: 'sec-git' })
  expect(await ui.find({ type: 'Text', text: /CI red: lint on feat\/y · no PR yet/ })).toBeDefined()
  await ui.press({ key: 'git-run-test' })
  expect(fills.at(-1)?.text).toBe('Run `pnpm test` and fix what fails.')
  await ui.press({ key: 'git-run-build' })
  expect(fills.at(-1)?.text).toBe('Run `pnpm build` and fix any errors.')
  expect(await ui.find({ key: 'git-run-dev' })).toBeUndefined()
  await ui.unmount()
  gitFixture = null
  checksFixture = null
})

test('Usage counts advisor calls from the main thread, and /btw and /advisor fill the prompt', async ($, on) => {
  const fills: any[] = []
  engine(on)
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e), { isFilled: true }))
  const step = (agentId?: string) => ({
    turnId: 't', index: 0, answer: '', toolUses: [], stopReason: 'end_turn', usage: null,
    serverToolUses: [{ id: `a-${agentId ?? 'main'}`, name: 'advisor', input: {}, startedAt: 1_790_000_000_000, endedAt: 1_790_000_012_000 }],
  })
  let nextStep: any = step()
  on('turn.step', async function* () {
    return nextStep
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const run = async (agentId?: string) => {
    nextStep = step(agentId)
    const s = $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
    for await (const _ of s) void _
    await s.result
  }
  await run()
  await run('sub-1') // a subagent's advisor call isn't this session's
  await run()
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await ui.press({ key: 'sec-usage' })
  await ui.press({ key: 'limits-75-90' })
  expect(await ui.find({ type: 'Text', text: /2 calls this session · last \d{1,2}:\d\d.*, 12s/ })).toBeDefined()
  await ui.press({ key: 'usage-advisor' })
  expect(fills.at(-1)).toMatchObject({ text: '/advisor ', mode: 'replace' })
  await ui.press({ key: 'sec-quick' })
  await ui.press({ key: 'quick-btw' })
  expect(fills.at(-1)).toMatchObject({ text: '/btw ', mode: 'replace' })
  await ui.unmount()
})

test('Usage shows the main thread\'s tokens on the current model, and the others it used', async ($, on) => {
  const fills: any[] = []
  engine(on)
  on('prompt.fill', (_: unknown, e: any) => (fills.push(e), { isFilled: true }))
  on('session.model', () => ({ value: 'Opus 5.5' }))
  const use = (model: string, input: number, output: number, cacheRead: number) => ({
    model, input_tokens: input, output_tokens: output, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: 0,
  })
  let nextStep: any
  on('turn.step', async function* () {
    return nextStep
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  const run = async (usage: any, agentId?: string) => {
    nextStep = { turnId: 't', index: 0, answer: '', toolUses: [], serverToolUses: [], stopReason: 'end_turn', usage }
    const s = $.turn.step({ turnId: 't', index: 0, model: 'opus', messageCount: 1, ...(agentId ? { agentId } : {}) } as any)
    for await (const _ of s) void _
    await s.result
  }
  await run(use('claude-haiku-5-5', 9_000, 1_000, 3_000))
  await run(use('claude-opus-5-5', 100_000, 20_000, 900_000))
  await run(use('claude-sonnet-5-5', 500_000, 5_000, 0), 'sub-1') // a subagent's tokens aren't counted
  await run(use('claude-opus-5-5', 0, 28_000, 200_000))
  await $.turn.complete(TURN)
  const ui = await $.ui.mount({ ...pane('operator', 'operator'), surface: 'terminal' })
  await ui.press({ key: 'sec-usage' })
  await ui.press({ key: 'limits-75-90' })
  expect(await ui.find({ type: 'Text', text: /Opus 5\.5/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /1\.2M in · 48k out · 92% cached/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /also haiku-5-5 12k in/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /sonnet/ })).toBeUndefined()
  await ui.press({ key: 'usage-model' })
  expect(fills.at(-1)).toMatchObject({ text: '/model ', mode: 'replace' })
  await ui.unmount()
})

test('the crew band shows a subagent live: its step, model, tokens; view, msg and stop reach it', async ($, on) => {
  const views: any[] = []
  const sends: any[] = []
  const stops: any[] = []
  let listed: any[] = [{ id: 'a1', status: 'running' }]
  engine(on)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('agent.list', () => ({ value: listed }))
  on('ui.view', (_: unknown, e: any) => (views.push(e), { value: {} }))
  on('session.send', (_: unknown, e: any) => (sends.push(e), { isDelivered: true }))
  on('tool.call', (_: unknown, e: any) => {
    if (e.tool === 'TaskStop') stops.push(e)
    return { result: 'ok' }
  })
  let nextStep: any
  on('turn.step', async function* () {
    return nextStep
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'Find the flaky test', description: 'hunt flaky test', subagentType: 'Explore' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'retry\\(', agentId: 'a1' } as any)
  nextStep = {
    turnId: 't', index: 0, answer: '', toolUses: [], serverToolUses: [], stopReason: 'tool_use',
    usage: { model: 'claude-haiku-5-5', input_tokens: 2_000, output_tokens: 1_500, cache_read_input_tokens: 10_000, cache_creation_input_tokens: 0 },
  }
  const s = $.turn.step({ turnId: 't', index: 0, model: 'haiku', messageCount: 1, agentId: 'a1' } as any)
  for await (const _ of s) void _
  await s.result
  const band = { plugin: 'operator-board', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any
  let ui = await $.ui.mount(band)
  expect(await ui.find({ key: 'crew-fold', text: /crew 1 running/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /hunt flaky test · Explore · haiku-5-5 · 0s · 12k in 2k out/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /↳ Grep retry\\\(/ })).toBeDefined()
  await ui.press({ key: 'crew-view-a1' })
  expect(views.at(-1)).toMatchObject({ agentId: 'a1' })
  await ui.press({ key: 'crew-msg-a1' })
  await ui.input({ key: 'crew-input-a1', text: 'skip the e2e suite' })
  expect(sends.at(-1)).toMatchObject({ to: 'a1', text: 'skip the e2e suite' })
  await ui.press({ key: 'crew-stop-a1' })
  expect(stops.at(-1)).toMatchObject({ task_id: 'a1' })
  await ui.unmount()
  // Once the engine no longer lists it running, the tick marks it done; folded, it is one line.
  listed = [{ id: 'a1', status: 'completed' }]
  await $.turn.complete({ ...TURN, agentId: 'a1' } as any)
  ui = await $.ui.mount(band)
  expect(await ui.find({ key: 'crew-fold', text: /crew 0 running · 1 done/ })).toBeDefined()
  await ui.press({ key: 'crew-fold' })
  expect(await ui.find({ key: 'crew-view-a1' })).toBeUndefined()
  await ui.unmount()
})

test('the crew tick: a failed list or a workflow agent stays running; listed then gone is done; done drops after a minute', async ($, on) => {
  const clock = engine(on)
  let listed: any = () => [{ id: 'a1', status: 'running' }]
  let spawnId = 'a1'
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: spawnId }))
  on('agent.list', () => {
    const l = listed()
    return { value: l }
  })
  await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
  await $.agent.spawn({ prompt: 'p', description: 'listed agent', subagentType: 'Explore' } as any)
  spawnId = 'w1'
  await $.agent.spawn({ prompt: 'p', description: 'workflow agent', subagentType: 'general-purpose' } as any)
  const band = { plugin: 'operator-board', component: 'AbovePrompt', surface: 'terminal',
    props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 10 }, view: {} } } as any
  const header = async () => {
    const ui = await $.ui.mount(band)
    const t = (await ui.find({ key: 'crew-fold' }))?.props?.label ?? ''
    await ui.unmount()
    return t
  }
  await clock.advance(5_000) // a1 is listed, w1 (a workflow's) never is
  expect(await header()).toMatch(/crew 2 running$/)
  listed = () => {
    throw new Error('list failed')
  }
  await clock.advance(5_000)
  expect(await header()).toMatch(/crew 2 running$/)
  listed = () => []
  await clock.advance(5_000) // a1 left the list: done; w1 was never in it: still running
  expect(await header()).toMatch(/crew 1 running · 1 done/)
  await clock.advance(65_000)
  expect(await header()).toMatch(/crew 1 running$/)
})

for (const alertSound of [true, false])
  test(`an alert ${alertSound ? 'plays' : "doesn't play"} the alert sound with Alert sound ${alertSound ? 'on' : 'off'}`, { options: { alertSound } }, async ($, on) => {
    engine(on)
    await $.session.start({ cwd: '/work/app', surface: 'terminal', isInteractive: true })
    ranArgv.length = 0
    await $.tool.call({ tool: 'mcp__operator-board__board_update', action: 'add', kind: 'reply', title: 'Ship it?' } as any)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as any)
    expect(notified.some(x => /needs your reply: Ship it\?/.test(JSON.stringify(x)))).toBe(true)
    expect(ranArgv.some(a => a[0] === 'uname')).toBe(alertSound)
  })
