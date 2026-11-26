/** A shell command Claude started in the background, by its task id. */
export type Task = { id: string; command: string; startedAt: number }
/** A process listening on a TCP port, whose working folder is in the project. */
export type Port = { pid: number; command: string; port: number }

declare module 'claude-code' {
  interface PluginState {
    procs: {
      /** Background shell tasks still running, oldest first. */
      tasks: Shaped<Task[]>
      /** Ports held by processes running in the project, lowest first. */
      ports: Shaped<Port[]>
      /** The band hidden with its hide button, until /procs show. */
      isHidden: boolean
    }
  }
}
