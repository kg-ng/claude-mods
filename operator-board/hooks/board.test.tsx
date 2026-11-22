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

function engine(on: any, opens: any[] = []) {
  on('session.id', () => ({ value: 'me' }))
  on('session.cwd', () => ({ value: '/work/app' }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.notify', (_: unknown, e: any) => {
    notified.push(e)
    return { value: { isSent: true, channel: 'iterm2' } }
  })
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.panes', () => ({ value: [] }))
  on('fs.write', (_: unknown, e: any) => {
    written.push(e)
    return { value: undefined }
  })
  on('command.run', () => ({ text: '' }))
  mock.clock(on, { now: 1_790_000_000_000 })
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
  on('process.run', (_: unknown, e: any) => ({
    value: {
      exitCode: e.argv?.[0] === 'git' ? (gitFixture ? 0 : 128) : 0,
      stdout:
        e.argv?.[0] === 'tail'
          ? historyFixture
          : e.argv?.[0] === 'git'
            ? (gitFixture?.[e.argv[3]] ?? '')
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

test('the operator pane opens on session start, asking for a right-hand dock width', async ($, on) => {
  const opens: any[] = []
  engine(on, opens)
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const board = opens.find(o => o.id === 'operator')
  expect(board).toBeDefined()
  expect(board.columns).toBe(48)
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
