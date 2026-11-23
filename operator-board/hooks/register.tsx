import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import {
  TOOL,
  TOOL_DESCRIPTION,
  TOOL_FULL,
  TOOL_SCHEMA,
  alertNeedsYou,
  applyBoard,
  boardBody,
  boardStats,
  getCwd,
  pairAnswer,
  pilotContext,
  recordAsk,
  restoreScope,
  setCwd,
  waitAlerts,
  watchBoard,
} from './board'
import type { BoardArgs } from './board'
import {
  CHECKPOINT_ASK,
  restoreAlerts,
  restoreTimeFmt,
  toggleAlerts,
  alertCount,
  alertsStrip,
  gitBody,
  gitNext,
  gitRepo,
  gitSnap,
  gitSummary,
  recordEdit,
  recordScroll,
  stillTarget,
  scrollbarColumn,
  quickSummary,
  usageLevel,
  usageSummary,
  loadCheckpoints,
  loadQuick,
  logUsage,
  pinQuick,
  quickBody,
  refreshGit,
  refreshUsage,
  saveCheckpoint,
  usageBody,
  recordAdvisor,
  recordModelUsage,
} from './extras'
import { CREW_TICK_MS, crewBand, crewDone, crewSpawned, crewStep, crewTick, crewTokens } from './crew'
import { BASE_LOOK, dim, watchLook } from './look'
import { PR_EVERY_MS, openPrKeys, prStats, prsBody, refreshPrs } from './prs'
import { loadRecall, recallBody, recallCount, saveRecall, setRecallQuery } from './recall'
import { refreshSessions, sessionRows, sessionsBody, sessionsUpdatedAt } from './sessions'
import {
  TODO_TOOL,
  TODO_TOOL_DESCRIPTION,
  TODO_TOOL_SCHEMA,
  applyTodoTool,
  autopilotAfterTurn,
  loadTodos,
  todoBody,
  todoCount,
} from './todo'
import { oneLine } from './util'
import type { $T } from './util'

/**
 * The hooks: commands, tools, the band above the prompt and the operator pane. Each section's
 * state and drawing lives in its own module (board, prs, sessions, recall, extras, todo).
 */

// One pane holds every section; each section folds open or closed.
const PANE = { id: 'operator', title: 'operator' } as const
const SECTIONS = {
  board: 'Board',
  todo: 'To-do',
  usage: 'Usage',
  git: 'Git',
  sessions: 'Sessions',
  quick: 'Quick prompts',
  prs: 'PRs',
  recall: 'Recall',
} as const
type PaneKey = keyof typeof SECTIONS

// The CLI theme published by persona (see look.ts).
const look = atom({ plugin: 'operator-board', key: 'look' } as const, BASE_LOOK, { shape: 'look-1' })
const STORE_OPEN = 'sections-v1'
// Every section starts folded; what the person opens is remembered for the next session.
const DEFAULT_OPEN: Record<PaneKey, boolean> = {
  board: false,
  todo: false,
  usage: false,
  git: false,
  sessions: false,
  quick: false,
  prs: false,
  recall: false,
}
const CP_TOOL = 'checkpoint_save'
const TICK_MS = 60 * 1000
const openSections = atom({ plugin: 'operator-board', key: 'openSections' } as const, DEFAULT_OPEN, {
  shape: 'sections-1',
})

// ---------- panes ----------

/**
 * True only while the pane is drawn. The pane opened at session start is "unasked", and on a
 * terminal under 144 columns (110 once you've opened it yourself) it waits open but undrawn:
 * that counts as closed, so /operator shows it instead of closing it.
 */
const isPaneOpen = async ($: $T) => (await $.ui.panes()).some(p => p.id === PANE.id && p.isPlaced)

async function openPane($: $T) {
  // No fixed width: the dock takes Claude Code's share of the terminal and follows it as the
  // terminal resizes; a width the person drags or keys the dock to wins and is kept.
  const opened = await $.ui.open({ id: PANE.id, title: PANE.title })
  measurePane($, 'start')
  return opened
}

/**
 * Asks for a scroll that doesn't move, so the engine reports the pane's height for the
 * scrollbar. Only from a press or an open, never while drawing: a scroll redraws.
 */
async function measurePane($: $T, to: 'start' | { key: string }) {
  await $.ui.scroll({ in: PANE.id, to }).catch(() => undefined)
}

async function setSection($: $T, key: PaneKey, open: boolean) {
  let next_: Record<PaneKey, boolean> = DEFAULT_OPEN
  await update($, openSections, s => (next_ = { ...s, [key]: open }))
  await $.store.set(STORE_OPEN, next_)
  // The header just pressed is on screen, so revealing it moves nothing.
  await measurePane($, { key: `sec-${key}` })
}

// Band button or command: closed pane -> open it on that section; section showing -> fold it; folded -> unfold it.
async function showSection($: $T, key: PaneKey) {
  if (!(await isPaneOpen($))) {
    await setSection($, key, true)
    await openPane($)
    return
  }
  const open = (await read($, openSections))[key]
  await setSection($, key, !open)
}

/** Section order for the pane: sections that need you first, the rest as listed. */
export function paneOrder<K extends string>(keys: readonly K[], urgent: ReadonlySet<K>): K[] {
  return [...keys.filter(k => urgent.has(k)), ...keys.filter(k => !urgent.has(k))]
}

// ---------- the scrollbar's measure ----------

const REMEASURE_MS = 3000
let measuredAs = ''

/**
 * When what the pane holds has changed (new board items, a PR refresh, a fold), asks for a
 * scroll that moves nothing, so the engine reports the new height and the scrollbar keeps
 * its size. Cheap when nothing changed: it compares counts, and only then scrolls.
 */
async function remeasure($: $T) {
  if (!(await isPaneOpen($))) return
  const g = await gitSnap($)
  const sig = JSON.stringify([
    await read($, openSections),
    await boardStats($),
    await prStats($),
    (await sessionRows($)).length,
    await recallCount($),
    await todoCount($, await getCwd($)),
    await alertCount($),
    [g.changed, g.files?.length, g.claude?.paths.length, g.run?.length, g.ci, g.last],
  ])
  if (sig === measuredAs) return
  measuredAs = sig
  await measurePane($, await stillTarget($))
}

// ---------- periodic checks ----------
async function tick($: $T) {
  await loadTodos($)
  await refreshUsage($)
  await refreshGit($)
  await waitAlerts($)
}

// ---------- register ----------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await loadRecall($)

    await $.tool.register({
      name: TOOL,
      description: TOOL_DESCRIPTION,
      inputSchema: TOOL_SCHEMA,
      isDeferred: false,
    })
    await $.command.register({ name: 'operator', description: 'Open or close the operator pane' })
    await $.command.register({ name: 'board', description: 'Show or fold the board section' })
    await $.command.register({ name: 'sessions', description: 'Show or fold earlier sessions to resume' })
    await $.command.register({ name: 'prs', description: 'Show or fold the PRs section (refreshes)' })
    await $.command.register({
      name: 'recall',
      description: 'Search earlier questions and answers',
      argumentHint: '[words or "a phrase"]',
    })

    await setCwd($, e.cwd)
    await restoreAlerts($)
    await restoreTimeFmt($)
    await loadCheckpoints($)
    await loadQuick($)
    await loadTodos($)
    await $.tool.register({ name: TODO_TOOL, description: TODO_TOOL_DESCRIPTION, inputSchema: TODO_TOOL_SCHEMA, isDeferred: false })
    await $.tool.register({
      name: CP_TOOL,
      description:
        "Save a checkpoint for this session on the user's operator board: one or two lines on where things stand and the next step. Use it when the user asks for a checkpoint, says they are stopping, or a sprint or gate closes. The user can later start a new session from it.",
      inputSchema: {
        type: 'object',
        properties: { note: { type: 'string', description: 'Where things stand and the next step.' } },
        required: ['note'],
      },
      isDeferred: false,
    })
    await $.command.register({ name: 'savepoint', description: 'Save a checkpoint of this session (Sessions can continue from it)', argumentHint: '[note]' })
    await $.command.register({ name: 'quick', description: 'Pin a quick prompt', argumentHint: '<prompt text>' })
    await $.command.register({ name: 'alerts', description: 'Turn operator alerts on or off', argumentHint: '[on|off]' })
    $.clock.every(TICK_MS, () => void tick($))
    $.clock.every(CREW_TICK_MS, () => void crewTick($))
    $.clock.every(REMEASURE_MS, () => void remeasure($))
    void refreshUsage($)
    void refreshGit($)
    await restoreScope($)
    await watchBoard($)
    await watchLook($, l => update($, look, () => l))
    $.clock.every(PR_EVERY_MS, () => void refreshPrs($))
    void refreshPrs($)
    void refreshSessions($)

    // Open the operator pane for every new session; it docks right in a wide fullscreen terminal.
    const folds = (await $.store.get(STORE_OPEN)) as Record<PaneKey, boolean> | undefined
    if (folds && typeof folds === 'object') await update($, openSections, () => ({ ...DEFAULT_OPEN, ...folds }))
    await openPane($)
    // Held back on a narrow terminal: the band's "show operator pane" button says so, not a log line.

    return next(e)
  })

  // Board tool, answered by the mod.
  on('tool.call', { tool: TOOL_FULL }, async ($, e) => {
    const text = await applyBoard($, e as unknown as BoardArgs)
    return { result: text }
  })

  // Files Claude edits: Git shows them as "Claude changed N files" until they're committed.
  on('tool.call', { tool: /^(Edit|Write|MultiEdit|NotebookEdit)$/ }, async ($, e, next) => {
    const done = await next(e)
    const path = (e as { file_path?: unknown; notebook_path?: unknown }).file_path ?? (e as { notebook_path?: unknown }).notebook_path
    if (typeof path === 'string' && !('deny' in done) && !(done as { isError?: boolean }).isError)
      await recordEdit($, path).catch(() => undefined)
    return done
  })

  // Commands.
  on('command.run', { command: 'operator' }, async $ => {
    if (await isPaneOpen($)) {
      await $.ui.close({ id: PANE.id })
      return { text: 'Closed the operator pane.' }
    }
    await openPane($)
    return { text: 'Opened the operator pane.' }
  })
  on('tool.call', { tool: 'mcp__operator-board__todo_update' }, async ($, e) => {
    const text = await applyTodoTool($, e as unknown as { action: string }, await getCwd($))
    return { result: text }
  })

  on('tool.call', { tool: 'mcp__operator-board__checkpoint_save' }, async ($, e) => {
    const note = String((e as unknown as { note?: string }).note ?? '').trim()
    if (!note) return { result: 'checkpoint_save needs a note.' }
    const cp = await saveCheckpoint($, note)
    $.ui.toast(`Checkpoint saved: ${oneLine(cp.note, 60)}`)
    return { result: `Saved checkpoint ${cp.id}.` }
  })

  on('command.run', { command: 'savepoint' }, async ($, e) => {
    const note = e.args.trim()
    if (!note) {
      await $.prompt.fill({ text: CHECKPOINT_ASK, mode: 'replace' })
      return { text: 'Press Enter and Claude will write the checkpoint.' }
    }
    await saveCheckpoint($, note)
    return { text: `Checkpoint saved: ${oneLine(note, 80)}` }
  })
  on('command.run', { command: 'quick' }, async ($, e) => {
    if (!e.args.trim()) {
      await setSection($, 'quick', true)
      await openPane($)
      return { text: 'Quick prompts opened.' }
    }
    await pinQuick($, e.args)
    return { text: `Pinned: ${oneLine(e.args, 80)}` }
  })
  on('command.run', { command: 'alerts' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    const on_ = await toggleAlerts($, arg === 'on' ? true : arg === 'off' ? false : undefined)
    return { text: `Operator alerts ${on_ ? 'on' : 'off'}.` }
  })

  // A last usage reading when the session ends.
  on('session.end', async ($, e, next) => {
    try {
      await refreshUsage($)
      await logUsage($, 'end')
    } catch {
      // Ending anyway.
    }
    return next(e)
  })

  on('command.run', { command: 'board' }, async $ => {
    await showSection($, 'board')
    return { text: 'Toggled the board section.' }
  })
  on('command.run', { command: 'sessions' }, async $ => {
    void refreshSessions($)
    await showSection($, 'sessions')
    return { text: 'Toggled the sessions section.' }
  })
  on('command.run', { command: 'prs' }, async $ => {
    void refreshPrs($)
    await showSection($, 'prs')
    return { text: 'Toggled the PRs section.' }
  })
  on('command.run', { command: 'recall' }, async ($, e) => {
    const q = e.args.trim()
    if (q) await setRecallQuery($, q)
    await setSection($, 'recall', true)
    await openPane($)
    return { text: q ? `Recall: searching "${q}".` : 'Recall opened.' }
  })

  // Capture questions, and tell Claude which needs-reply items are open.
  on('prompt.submit', async ($, e, next) => {
    if (e.command || e.isMeta || !e.text.trim()) return next(e)
    const note = await recordAsk($, e.text.trim())
    if (!note) return next(e)
    return next({ ...e, context: [...(e.context ?? []), note] })
  })

  // The advisor runs inside the API request, so its calls show only in the step's response.
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (!e.agentId) {
      await recordAdvisor($, r.serverToolUses)
      await recordModelUsage($, r.usage)
    } else await crewTokens($, e.agentId, r.usage)
    return r
  })

  // ---------- crew: the session's subagents, live in the band ----------
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    if (!r.deny) await crewSpawned($, e, r)
    return r
  })
  // Any subagent's tool call moves its step; the main thread's pass through untouched.
  on('tool.call', async ($, e, next) => {
    if (e.agentId) await crewStep($, e.agentId, e.tool, e).catch(() => undefined)
    return next(e)
  })

  // Pair the main thread's answer with the question, and save it for recall.
  on('turn.complete', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId) await crewDone($, e.agentId, e.isAborted)
    if (e.agentId || e.isAborted || !e.answer.trim()) return done
    const paired = await pairAnswer($, e.answer.trim())
    if (paired) await saveRecall($, paired)
    if ((await $.clock.now()) - (await prStats($)).updatedAt > 60000) void refreshPrs($)
    if ((await $.clock.now()) - (await sessionsUpdatedAt($)) > 60000) void refreshSessions($)
    void refreshUsage($)
    void refreshGit($)
    await alertNeedsYou($)
    await autopilotAfterTurn($, await pilotContext($))
    return done
  })

  // ---------- band ----------
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const L = await read($, look)
    const { replies } = await boardStats($)
    const { total, red } = await prStats($)
    const prLabel = `PRs (${total}${red ? `, ${red} red` : ''})`
    const alertsN = await alertCount($)
    // Opened at session start but held back undrawn (terminal under Claude Code's width floor
    // for a pane opened on its own): one press opens it, since a press is the person asking.
    const isHeld = (await $.ui.panes()).some(p => p.id === PANE.id && !p.isPlaced)
    const crewRows = await crewBand($, e, L)
    const buttons = (
      <Box flexDirection="row" gap={2}>
        {isHeld && (
          <Button key="band-show-pane" plain variant="primary" label="▸ show operator pane" onPress={() => openPane($)} />
        )}
        <Button
          key="band-board"
          plain
          variant={replies ? 'primary' : undefined}
          label={replies ? `board (${replies} need reply)` : 'board'}
          onPress={() => showSection($, 'board')}
        />
        <Button key="band-recall" plain label="recall" onPress={() => showSection($, 'recall')} />
        <Button
          key="band-prs"
          plain
          label={prLabel}
          onPress={() => {
            void refreshPrs($)
            return showSection($, 'prs')
          }}
        />
        {red > 0 && <Text color={L.err}>●</Text>}
        {alertsN > 0 && (
          <Button
            key="band-alerts"
            plain
            variant="primary"
            label={`● ${alertsN} alert${alertsN > 1 ? 's' : ''}`}
            onPress={async () => {
              if (!(await isPaneOpen($))) await openPane($)
            }}
          />
        )}
      </Box>
    )
    if (!crewRows) return buttons
    return (
      <Box flexDirection="column">
        {buttons}
        {crewRows}
      </Box>
    )
  })

  // ---------- the operator pane: every section in one place ----------
  on('ui.scroll', { component: 'Pane', requestId: PANE.id }, async ($, e, next) => {
    await recordScroll($, e.contentRows, e.bodyRows).catch(() => undefined)
    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE.id }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const L = await read($, look)
    const open = await read($, openSections)
    const { replies, pending: pendingN } = await boardStats($)
    const { total, red, toReview } = await prStats($)
    const sessN = (await sessionRows($)).length
    const recallN = await recallCount($)
    const level = await usageLevel($)
    const counts: Record<PaneKey, string> = {
      board:
        replies || pendingN
          ? ` (${[replies && `${replies} need reply`, pendingN && `${pendingN} pending`].filter(Boolean).join(', ')})`
          : '',
      todo: await todoCount($, await getCwd($)),
      usage: await usageSummary($),
      git: await gitSummary($),
      sessions: sessN ? ` (${sessN})` : '',
      quick: await quickSummary($),
      prs: ` (${total}${red ? `, ${red} red` : ''}${toReview ? ` · ${toReview} to review` : ''})`,
      recall: recallN ? ` (${recallN} saved)` : '',
    }
    // The branch's next step (push / open PR), a button on the Git header itself.
    const prKeys = await openPrKeys($)
    const g = await gitSnap($)
    const nextStep = gitNext(g, (repo, branch) => prKeys.has(`${repo}:${branch}`))
    const branchHasPr = !!g.repo && prKeys.has(`${g.repo}:${g.branch ?? ''}`)
    // 1-8 open or fold sections while the pane has the keyboard; the digit shows then.
    const keyOf = (k: PaneKey) => String((Object.keys(SECTIONS) as PaneKey[]).indexOf(k) + 1)
    const isFocused = e.props.isFocused === true
    const headColor = (k: PaneKey) =>
      (k === 'prs' && red) || (k === 'usage' && level === 'stop')
        ? L.err
        : (k === 'board' && replies) || (k === 'usage' && level === 'warn')
          ? L.warn
          : L.accent
    // Sections that need you (a reply waiting, red CI, usage at your limits) come first.
    const urgent = new Set<PaneKey>()
    if (replies) urgent.add('board')
    if (red) urgent.add('prs')
    if (level) urgent.add('usage')
    const keys = paneOrder(Object.keys(SECTIONS) as PaneKey[], urgent)
    const rendered: Record<PaneKey, unknown> = {
      board: open.board ? await boardBody($, e, L) : null,
      todo: open.todo ? await todoBody($, e, L, await pilotContext($)) : null,
      usage: open.usage ? await usageBody($, e, L) : null,
      git: open.git ? await gitBody($, e, L, branchHasPr) : null,
      sessions: open.sessions ? await sessionsBody($, e, L) : null,
      quick: open.quick ? await quickBody($, e, L) : null,
      prs: open.prs ? await prsBody($, e, L, await gitRepo($)) : null,
      recall: open.recall ? await recallBody($, e, L) : null,
    }
    return (
      <Box flexDirection="column" gap={1} paddingRight={1}>
        {await scrollbarColumn($, e, L)}
        {await alertsStrip($, e, L)}
        {keys.map(k => (
          <Box flexDirection="column" key={`section-${k}`}>
            <Box flexDirection="row" gap={1}>
              <Box flexGrow={1} flexShrink={1}>
                <Button key={`sec-${k}`} plain hotkey={keyOf(k)} onPress={() => setSection($, k, !open[k])}>
                  <Text wrap="truncate-end" color={headColor(k)} bold>
                    {isFocused && <Text {...dim(L)}>{keyOf(k)} </Text>}
                    {open[k] ? '▾' : '▸'} {SECTIONS[k]}
                    {counts[k]}
                  </Text>
                </Button>
              </Box>
              {k === 'git' && nextStep && (
                <Button
                  key="git-next"
                  plain
                  variant="primary"
                  label={nextStep.label}
                  onPress={() => $.prompt.fill({ text: nextStep.text, mode: 'replace' })}
                />
              )}
            </Box>
            {rendered[k] as any}
          </Box>
        ))}
      </Box>
    )
  })
}
