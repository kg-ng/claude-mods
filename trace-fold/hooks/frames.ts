// trace-fold's reader: finds stack frames in command output, tells your code's frames from
// library and runtime ones, and folds each run of library frames to one line.

/** One frame line's language and whether it's library or runtime code (not yours). */
export type Frame = { lang: 'js' | 'python' | 'java' | 'go'; isLibrary: boolean; lines: number }

const JS_FRAME = /^\s+at (?:.+ \()?(.+?):\d+(?::\d+)?\)?$|^\s+at (?:async )?[\w$.<>]+ \((?:native|<anonymous>|node:[^)]+)\)$/
const JS_LIB = /node_modules|node:internal|^node:|internal\/|<anonymous>|\(native\)|webpack\/bootstrap|bun:|deno:/
const PY_FRAME = /^\s+File "(.+?)", line \d+/
const PY_LIB = /site-packages|dist-packages|\/lib\/python\d|<frozen |\/\.venv\/|\/venv\/|\/usr\/lib\//
const JAVA_FRAME = /^\s+at (?:[\w.@-]+\/)?([\w$.]+)\([^)]*\)$/
const JAVA_LIB = /^(?:java|javax|jdk|sun|com\.sun|kotlin|kotlinx|scala|org\.junit|org\.springframework|org\.apache|org\.gradle|io\.netty|reactor|worker\.org\.gradle)\./
const GO_FILE = /^\t(\/.+?\.go):\d+/
const GO_LIB = /\/go\/src\/|\/libexec\/src\/|\/pkg\/mod\/|\/usr\/local\/go\/|\/runtime\//

/** The frame starting at line `i`, or undefined when that line isn't one. */
export function frameAt(lines: string[], i: number): Frame | undefined {
  const l = lines[i]!
  const java = JAVA_FRAME.exec(l)
  if (java && /\.(?:java|kt|scala|groovy):\d+\)|Native Method|Unknown Source/.test(l))
    return { lang: 'java', isLibrary: JAVA_LIB.test(java[1]!), lines: 1 }
  const js = JS_FRAME.exec(l)
  if (js) return { lang: 'js', isLibrary: JS_LIB.test(l), lines: 1 }
  const py = PY_FRAME.exec(l)
  if (py) {
    // The source line under a Python frame belongs to it (and the ^^^ marker under that).
    let n = 1
    while (n < 3 && i + n < lines.length && /^\s{4,}\S/.test(lines[i + n]!) && !PY_FRAME.test(lines[i + n]!)) n++
    return { lang: 'python', isLibrary: PY_LIB.test(py[1]!), lines: n }
  }
  // Go: "pkg.fn(...)" then "\t/path/file.go:12 +0x1d".
  if (i + 1 < lines.length && /^[\w./*()-]+\(.*\)$/.test(l)) {
    const go = GO_FILE.exec(lines[i + 1]!)
    if (go) return { lang: 'go', isLibrary: GO_LIB.test(go[1]!) || /^runtime\./.test(l), lines: 2 }
  }
}

export type Folded = { text: string; hidden: number }

/**
 * The text with each run of at least `minRun` library frames replaced by one line,
 * `    … 14 library frames (node_modules)`. Your frames, messages and the rest stay.
 */
export function fold(text: string, minRun = 3): Folded {
  const lines = text.split('\n')
  const out: string[] = []
  let hidden = 0
  let i = 0
  while (i < lines.length) {
    const f = frameAt(lines, i)
    if (!f?.isLibrary) {
      out.push(lines[i]!)
      i++
      continue
    }
    // A run of library frames, taken whole.
    const start = i
    let count = 0
    let where = ''
    let g: Frame | undefined = f
    while (g?.isLibrary) {
      where ||= place(lines[i]!)
      count++
      i += g.lines
      g = i < lines.length ? frameAt(lines, i) : undefined
    }
    if (count < minRun) {
      out.push(...lines.slice(start, i))
      continue
    }
    const indent = /^\s*/.exec(lines[start]!)![0]
    out.push(`${indent}… ${count} library frames${where ? ` (${where})` : ''}`)
    hidden += count
  }
  return { text: out.join('\n'), hidden }
}

/** A short name for where library frames come from: the package, or the runtime. */
function place(line: string): string {
  const pkg = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(line) ?? /site-packages\/([^/]+)/.exec(line) ?? /\/pkg\/mod\/([^@]+)/.exec(line)
  if (pkg) return pkg[1]!
  if (/node:|internal\//.test(line)) return 'node'
  if (/lib\/python|<frozen/.test(line)) return 'python'
  const jvm = /^\s+at (?:[\w.@-]+\/)?(java|jdk|sun|kotlin|org\.junit|org\.springframework)\./.exec(line)
  if (jvm) return jvm[1]!
  return ''
}
