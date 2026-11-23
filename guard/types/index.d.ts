/** What guard keeps in the session's state. */
export type Stop = { at: number; rule: string; command: string }

declare module 'claude-code' {
  interface PluginState {
    guard: {
      /** On unless /guard off. */
      isOn: boolean
      /** The last few commands it stopped, newest first. */
      stops: Shaped<Stop[]>
    }
  }
}
