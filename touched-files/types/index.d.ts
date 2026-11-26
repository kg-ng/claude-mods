/** One file Claude touched this session: how often, and roughly how much context it took. */
export type Touch = {
  /** Relative to the project when inside it, else absolute. */
  path: string
  reads: number
  edits: number
  /** About how many tokens of this file went through Claude's context: what it read, and what it wrote. */
  tokens: number
}

declare module 'claude-code' {
  interface PluginState {
    'touched-files': {
      /** Every file touched this session, in the order first touched. */
      files: Shaped<Touch[]>
    }
  }
}
