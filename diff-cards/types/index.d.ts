/** A tool call's id, as `tool.call` carried it. */
export type ToolUseId = string

declare module 'claude-code' {
  interface PluginState {
    'diff-cards': {
      /** Tool calls whose diff the person unfolded, newest last. */
      open: Shaped<ToolUseId[]>
    }
  }
}
