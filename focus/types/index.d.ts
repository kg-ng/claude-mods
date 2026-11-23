/** A notification held back during a focus session. */
export type Held = { at: number; text: string }

/** The running focus session; endAt 0 when there is none. */
export type Session = { startedAt: number; endAt: number; held: Held[]; mutedSounds: number }

declare module 'claude-code' {
  interface PluginState {
    focus: {
      session: Shaped<Session>
    }
  }
}
