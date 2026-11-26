/** The last run of a test, lint, typecheck or build command. */
export type Check = { command: string; ok: boolean }
/** HEAD when the session started, so commits since can be listed. */
export type Start = { head?: string }

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
