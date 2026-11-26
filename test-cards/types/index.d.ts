/** A tool call's id, as `tool.call` carried it. */
export type ToolUseId = string

declare module 'claude-code' {
  interface PluginState {
    'test-cards': {
      /** Test runs whose output the person unfolded, newest last. */
      open: Shaped<ToolUseId[]>
    }
  }
}
