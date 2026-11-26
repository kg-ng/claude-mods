/** One thing secrets-guard stopped: where and what kind, never the value. */
export type Stop = { at: number; where: string; kind: string }

declare module 'claude-code' {
  interface PluginState {
    'secrets-guard': {
      /** On unless /secrets off. */
      isOn: boolean
      /** The last few things it stopped, newest first. */
      stops: Shaped<Stop[]>
    }
  }
}
