/** One finished main-thread turn: how long it took, its tokens, and what the session's cost rose by. */
export type TurnReading = {
  durationMs: number
  input: number
  output: number
  cacheRead: number
  costUsd?: number
}

declare module 'claude-code' {
  interface PluginState {
    'turn-meter': {
      /** Recent turns, oldest first. */
      turns: Shaped<TurnReading[]>
      /** The session's cost at the end of the last turn, to take the next turn's from. */
      costSoFar: number
    }
  }
}
