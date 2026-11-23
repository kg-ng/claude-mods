/** The four sounds, from least to most urgent. */
export type ChimeKind = 'done' | 'good' | 'attention' | 'bad'

declare module 'claude-code' {
  interface PluginState {
    chimes: {
      /** On unless /chimes off. */
      isOn: boolean
      /** When the person last typed in the prompt. */
      typedAt: number
    }
  }
}
