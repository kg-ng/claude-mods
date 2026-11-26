// procs' readers: lsof's field output (-F) into processes and ports, and a port-in-use error
// out of a command's output. Pure, so tested on samples.
import type { Port } from '../types'

/** `lsof -nP -iTCP -sTCP:LISTEN -Fpcn`: one listener per process and port, lowest port first. */
export function listeners(out: string): Port[] {
  const found: Port[] = []
  let pid = 0
  let command = ''
  for (const line of out.split('\n')) {
    const tag = line[0]
    const v = line.slice(1)
    if (tag === 'p') {
      pid = Number(v)
      command = ''
    } else if (tag === 'c') command = v
    else if (tag === 'n' && pid) {
      const m = /:(\d+)$/.exec(v)
      if (!m) continue
      const port = Number(m[1])
      if (!found.some(f => f.pid === pid && f.port === port)) found.push({ pid, command, port })
    }
  }
  return found.sort((a, b) => a.port - b.port)
}

/** `lsof -a -d cwd -p 1,2 -Fpn`: each process's working folder. */
export function cwds(out: string): Map<number, string> {
  const map = new Map<number, string>()
  let pid = 0
  for (const line of out.split('\n')) {
    if (line[0] === 'p') pid = Number(line.slice(1))
    else if (line[0] === 'n' && pid) map.set(pid, line.slice(1))
  }
  return map
}

/** The port a command failed to bind, from the usual messages, or undefined. */
export function portInUse(text: string): number | undefined {
  const m =
    /EADDRINUSE[^\n]*?:(\d{2,5})\b/.exec(text) ??
    /[Aa]ddress already in use[^\n]*?(?:port |:)(\d{2,5})\b/.exec(text) ??
    /[Pp]ort (\d{2,5}) is (?:already )?in use/.exec(text) ??
    /:(\d{2,5}): bind: address already in use/.exec(text) ??
    /bind(?:ing)? (?:to )?[^\s]*:(\d{2,5})[^\n]*(?:in use|already)/.exec(text)
  return m ? Number(m[1]) : undefined
}

/** `4m`, `2h 5m`, `40s`. */
export function age(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}
