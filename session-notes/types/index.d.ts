/** The last run of a test, lint, typecheck or build command. */
export type Check = { command: string; ok: boolean; at: number }
/** When the session started, and HEAD then, so commits since can be listed. */
export type Start = { at: number; head?: string }

declare module 'claude-code' {
  interface PluginState {
    'session-notes': {
      /** What the person typed, first line of each, oldest first. */
      asks: Shaped<string[]>
      /** Files Claude edited, relative to the project, first edit first. */
      edited: Shaped<string[]>
      /** The latest result of each check command, newest last. */
      checks: Shaped<Check[]>
      /** Set once at the session's first start. */
      start: Start | null
    }
  }
}
