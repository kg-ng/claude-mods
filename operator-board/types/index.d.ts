/** The CLI theme a pane paints its chrome with (mirrors hooks/look.ts). */
export type Look = {
  name: string
  accent: string
  ok: string
  err: string
  warn: string
  muted: string
  fg: string
}

export type Ask = {
  id: string
  at: number
  question: string
  answer?: string
}

export type BoardItem = {
  id: string
  kind: 'reply' | 'pending'
  /** Pending items are grouped by section ("your action", "CI speedup"). */
  section: string
  title: string
  /** Background shown under a needs-reply item when Context is on. */
  context?: string
  /** Suggested reply text, put in the prompt by the Reply button. */
  reply?: string
  createdAt: number
  updatedAt: number
  /** Folder of the session that added it; the board's "this folder" view shows these. */
  project?: string
  /** Session that added it. */
  session?: string
}

export type PrCheckSummary = {
  passed: number
  failed: number
  running: number
  skipped: number
  failedNames: string[]
}

export type Pr = {
  repo: string
  number: number
  title: string
  url: string
  isDraft: boolean
  createdAt: string
  head: string
  reviewDecision: string | null
  openThreads: number
  ci: PrCheckSummary
  status: 'red' | 'running' | 'attention' | 'draft' | 'ready'
}

export type PrSnapshot = {
  updatedAt: number
  items: Pr[]
  error?: string
}

/** One earlier session, as ~/.claude/history.jsonl records it. */
export type SessionRow = {
  id: string
  project: string
  /** Last prompt typed in it (commands skipped), one line. */
  last: string
  /** Time of that last prompt, ms. */
  at: number
  prompts: number
  /** The session's name: its first prompt (commands skipped), one line. */
  name: string
  /** Its last three prompts, newest first. */
  recent: string[]
}

export type SessionsSnapshot = { updatedAt: number; items: SessionRow[]; error?: string }

/** Where usage warns and where the person stops; asked once, the first time. */
export type UsageLimits = { warn: number; stop: number; isSet: boolean }

export type UsageWindow = { pct: number; resetsAt?: string }
export type UsageSnap = {
  updatedAt: number
  contextPct?: number
  contextTokens?: number
  window?: number
  fiveHour?: UsageWindow
  sevenDay?: UsageWindow
  costUsd?: number
  error?: string
}

/** A note on where a session stood, to pick it up again later. */
export type Checkpoint = { id: string; at: number; note: string; session: string; project: string }

export type QuickPrompt = { id: string; text: string }

export type GitSnap = {
  updatedAt: number
  isRepo?: boolean
  branch?: string
  upstream?: string
  ahead?: number
  behind?: number
  changed?: number
  files?: string[]
  last?: string
  error?: string
}

/** One to-do item of a project folder's list. */
export type Todo = {
  id: string
  project: string
  title: string
  detail?: string
  /** proposed: added by Claude, waiting for the user's approval. */
  status: 'proposed' | 'todo' | 'doing' | 'done'
  by: 'you' | 'claude'
  createdAt: number
  updatedAt: number
  /** How Claude (or the user) knows it is done. */
  doneNote?: string
  /** The session that started it. */
  session?: string
}

/** A folder's list settings: autopilot runs in one session at a time. */
export type TodoList = {
  autopilot: boolean
  /** Items autopilot starts in a row before it pauses to check in. */
  cap: number
  streak: number
  runner?: string
  runnerAt?: number
  paused?: string
}

/** One alert this session raised, kept on the pane until dismissed. */
export type AlertEntry = { key: string; at: number; text: string }

export type TodoFile ={ v: 1; lists: Record<string, TodoList>; items: Todo[] }

declare module 'claude-code' {
  interface PluginState {
    'operator-board': {
      look: Shaped<Look>
      asks: Shaped<Ask[]>
      items: Shaped<BoardItem[]>
      prs: Shaped<PrSnapshot>
      showContext: boolean
      recallQuery: string
      recallPick: string | null
      recallIndex: Shaped<Ask[]>
      openSections: Shaped<Record<"board" | "todo" | "usage" | "git" | "sessions" | "quick" | "prs" | "recall", boolean>>
      todos: Shaped<TodoFile>
      todoNote: string
      usage: Shaped<UsageSnap>
      checkpoints: Shaped<Checkpoint[]>
      quick: Shaped<QuickPrompt[]>
      quickSuggest: Shaped<string[]>
      git: Shaped<GitSnap>
      alertsOn: boolean
      alertLog: Shaped<AlertEntry[]>
      timeFormat: string
      usageLimits: Shaped<UsageLimits>
      limitsDraft: Shaped<{ warn: number; stop: number }>
      sessions: Shaped<SessionsSnapshot>
      boardScope: 'here' | 'all'
      cwd: string
    }
  }
}
