import type { Palette } from './themes'

/** The elements the renderer draws with, from `$.ui.resolve(e)`. `Button` is optional: without it, no copy buttons. */
type El = { Box: any; Text: any; Button?: any }

/** What a code block's copy button does: copy `text`, the block's lines as written. */
export type CopyCode = (text: string, press: any) => unknown

type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'code'; lang: string; lines: string[] }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'list'; items: { indent: number; marker: string; task?: boolean; done?: boolean; text: string }[] }
  | { kind: 'table'; head: string[]; rows: string[][] }
  | { kind: 'hr' }

const LIST = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/
const isTableSep = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
const cells = (l: string) =>
  l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim())

export function parse(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]!
    if (line.trim() === '') { i++; continue }

    const fence = line.match(/^\s*(```+|~~~+)\s*([\w+#.-]*)/)
    if (fence) {
      const close = fence[1]!
      const body: string[] = []
      i++
      while (i < lines.length && !lines[i]!.trim().startsWith(close)) body.push(lines[i++]!)
      i++ // closing fence (or past the end while streaming)
      out.push({ kind: 'code', lang: fence[2] ?? '', lines: body })
      continue
    }
    const head = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/)
    if (head) { out.push({ kind: 'heading', level: head[1]!.length, text: head[2]! }); i++; continue }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { out.push({ kind: 'hr' }); i++; continue }
    if (/^\s*>/.test(line)) {
      const q: string[] = []
      while (i < lines.length && /^\s*>/.test(lines[i]!)) q.push(lines[i++]!.replace(/^\s*>\s?/, ''))
      out.push({ kind: 'quote', lines: q })
      continue
    }
    if (line.includes('|') && i + 1 < lines.length && isTableSep(lines[i + 1]!)) {
      const headCells = cells(line)
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i]!.includes('|') && lines[i]!.trim() !== '') rows.push(cells(lines[i++]!))
      out.push({ kind: 'table', head: headCells, rows })
      continue
    }
    if (LIST.test(line)) {
      const items: Extract<Block, { kind: 'list' }>['items'] = []
      while (i < lines.length) {
        const m = lines[i]!.match(LIST)
        if (m) {
          let text = m[3]!
          const task = text.match(/^\[([ xX])\]\s+(.*)$/)
          const item = { indent: Math.floor(m[1]!.replace(/\t/g, '  ').length / 2), marker: m[2]!, text }
          if (task) { text = task[2]!; items.push({ ...item, text, task: true, done: task[1] !== ' ' }) } else items.push(item)
          i++
        } else if (lines[i]!.trim() !== '' && /^\s{2,}/.test(lines[i]!) && items.length) {
          items[items.length - 1]!.text += ' ' + lines[i++]!.trim()
        } else break
      }
      out.push({ kind: 'list', items })
      continue
    }
    const para: string[] = []
    while (
      i < lines.length && lines[i]!.trim() !== '' &&
      !/^\s*(```|~~~|#{1,6}\s|>)/.test(lines[i]!) && !LIST.test(lines[i]!)
    ) para.push(lines[i++]!.trim())
    if (para.length === 0) { para.push(line.trim()); i++ }
    out.push({ kind: 'para', text: para.join(' ') })
  }
  return out
}

/** Inline markdown → coloured Text runs. */
export function inline(t: El, p: Palette, src: string, base: Record<string, unknown> = {}): any[] {
  const { Text } = t
  const out: any[] = []
  const re = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|~~([^~]+)~~|\*([^*\s][^*]*)\*|(?<![\w])_([^_\s][^_]*)_(?![\w])|\[([^\]]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s)]+)/g
  let last = 0
  for (const m of src.matchAll(re)) {
    if (m.index! > last) out.push(<Text {...base}>{src.slice(last, m.index)}</Text>)
    if (m[2] !== undefined) out.push(<Text color={p.write}>{m[2]}</Text>)
    else if (m[3] !== undefined || m[4] !== undefined) out.push(...inline(t, p, (m[3] ?? m[4])!, { ...base, bold: true, color: p.fg }))
    else if (m[5] !== undefined) out.push(<Text {...base} strikethrough>{m[5]}</Text>)
    else if (m[6] !== undefined || m[7] !== undefined) out.push(<Text {...base} italic>{m[6] ?? m[7]}</Text>)
    else if (m[8] !== undefined) out.push(<Text color={p.read} underline>{m[8]}</Text>)
    else if (m[10] !== undefined) out.push(<Text color={p.read} underline>{m[10]}</Text>)
    last = m.index! + m[0].length
  }
  if (last < src.length) out.push(<Text {...base}>{src.slice(last)}</Text>)
  return out
}

const plain = (s: string) => s.replace(/(`+)([^`]+?)\1/g, '$2').replace(/\*\*|__|~~/g, '').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')

const KEYWORDS = new Set(
  ('const let var function return if else for while do switch case break continue new class extends import from export default ' +
    'async await try catch finally throw typeof instanceof in of interface type enum public private protected static readonly ' +
    'def elif lambda pass with as yield None True False self fn pub mut impl struct use match mod package func go defer chan ' +
    'true false null undefined void this super echo then fi done esac local').split(' '),
)

function highlight(t: El, p: Palette, line: string, lang: string): any[] {
  const { Text } = t
  const hash = /^(py|python|sh|bash|zsh|shell|yaml|yml|toml|rb|ruby|r|make|dockerfile)$/i.test(lang)
  const re = hash
    ? /(#.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g
    : /(\/\/.*$|\/\*.*?\*\/|--\s.*$)|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.xXa-fA-F]*\b)|([A-Za-z_$][\w$]*)/g
  const out: any[] = []
  let last = 0
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push(<Text color={p.other}>{line.slice(last, m.index)}</Text>)
    if (m[1]) out.push(<Text color={p.muted} italic>{m[1]}</Text>)
    else if (m[2]) out.push(<Text color={p.ok}>{m[2]}</Text>)
    else if (m[3]) out.push(<Text color={p.write}>{m[3]}</Text>)
    else if (m[4]) {
      const word = m[4]
      const next = line[m.index! + word.length]
      out.push(
        KEYWORDS.has(word) ? <Text color={p.search}>{word}</Text>
          : next === '(' ? <Text color={p.web}>{word}</Text>
          : /^[A-Z]/.test(word) ? <Text color={p.run}>{word}</Text>
          : <Text color={p.fg}>{word}</Text>,
      )
    }
    last = m.index! + m[0].length
  }
  if (last < line.length) out.push(<Text color={p.other}>{line.slice(last)}</Text>)
  if (out.length === 0) out.push(<Text> </Text>)
  return out
}

function diffLine(t: El, p: Palette, line: string): any {
  const { Text } = t
  const color = line.startsWith('+') ? p.ok : line.startsWith('-') ? p.err : line.startsWith('@@') ? p.search : p.muted
  return <Text color={color}>{line || ' '}</Text>
}

/**
 * Column widths that fit `room` cells: the widest columns give up width first, none
 * below 6 (or its natural width). Null when even that does not fit.
 */
export function fitColumns(natural: number[], room: number): number[] | null {
  const w = [...natural]
  const floor = natural.map(n => Math.min(n, 6))
  let total = w.reduce((a, b) => a + b, 0)
  if (total <= room) return w
  if (floor.reduce((a, b) => a + b, 0) > room) return null
  while (total > room) {
    let i = 0
    for (let c = 1; c < w.length; c++) if (w[c]! - floor[c]! > w[i]! - floor[i]!) i = c
    if (w[i]! <= floor[i]!) return null
    w[i]! -= 1
    total -= 1
  }
  return w
}

/**
 * Word-wraps a cell to `width` visible characters, keeping its markdown: words are
 * measured without their markers, and a **bold** or `code` span cut by a line end
 * is closed there and opened again on the next line. Long words are split.
 */
export function wrapCell(src: string, width: number): string[] {
  const text = src.replace(/\s+/g, ' ').trim()
  if (plain(text).length <= width) return [text]
  const words: string[] = []
  for (let word of text.split(' ')) {
    while (plain(word).length > width && !/[`*]/.test(word)) {
      words.push(word.slice(0, width))
      word = word.slice(width)
    }
    words.push(word)
  }
  const raw: string[] = []
  let cur = ''
  for (const word of words) {
    if (!cur) cur = word
    else if (plain(cur).length + 1 + plain(word).length <= width) cur += ' ' + word
    else {
      raw.push(cur)
      cur = word
    }
  }
  if (cur) raw.push(cur)
  // Re-balance spans across line ends.
  const MARKS = ['**', '`'] as const
  const open = new Set<string>()
  return raw.map(line => {
    let l = [...open].join('') + line
    for (const m of MARKS) {
      // An odd count means the span is still open at this line's end.
      if ((l.split(m).length - 1) % 2 === 1) {
        l += m
        open.add(m)
      } else open.delete(m)
    }
    return l
  })
}

export function renderMarkdown(t: El, p: Palette, src: string, columns: number, copy?: CopyCode): any {
  const { Box, Text, Button } = t
  const blocks = parse(src)
  const width = Math.max(20, columns)
  const parts: any[] = []

  blocks.forEach((b, n) => {
    const gap = n > 0 ? { marginTop: 1 } : {}
    switch (b.kind) {
      case 'heading': {
        const color = b.level === 1 ? p.web : b.level === 2 ? p.search : p.read
        parts.push(
          <Box {...gap}>
            <Text bold color={color}>{b.level <= 2 ? '' : '› '}{inline(t, p, b.text, { bold: true, color })}</Text>
          </Box>,
        )
        break
      }
      case 'para':
        parts.push(<Box {...gap}><Text color={p.fg}>{inline(t, p, b.text, { color: p.fg })}</Text></Box>)
        break
      case 'hr':
        parts.push(<Box {...gap}><Text color={p.muted}>{'─'.repeat(Math.min(width, 60))}</Text></Box>)
        break
      case 'quote': {
        const alert = b.lines[0]?.match(/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i)
        const kind = alert?.[1]?.toUpperCase()
        const color = kind === 'WARNING' ? p.warn : kind === 'CAUTION' ? p.err : kind === 'TIP' ? p.ok : kind ? p.web : p.muted
        const body = alert ? b.lines.slice(1) : b.lines
        parts.push(
          <Box flexDirection="column" {...gap}>
            {kind && <Text color={color} bold>▎ {kind[0]}{kind.slice(1).toLowerCase()}</Text>}
            {body.map(l => (
              <Text><Text color={color}>▎ </Text><Text color={kind ? p.fg : p.muted} italic={!kind}>{inline(t, p, l, { color: kind ? p.fg : p.muted, italic: !kind })}</Text></Text>
            ))}
          </Box>,
        )
        break
      }
      case 'list': {
        let num = 0
        parts.push(
          <Box flexDirection="column" {...gap}>
            {b.items.map(it => {
              const ordered = /\d/.test(it.marker)
              if (ordered && it.indent === 0) num++
              const mark = it.task ? (it.done ? '✓' : '○') : ordered ? it.marker : it.indent > 0 ? '◦' : '•'
              const markColor = it.task ? (it.done ? p.ok : p.muted) : p.web
              return (
                <Box flexDirection="row" paddingLeft={it.indent * 2}>
                  <Text color={markColor}>{mark} </Text>
                  <Box flexGrow={1} flexShrink={1}>
                    <Text color={it.done ? p.muted : p.fg} strikethrough={it.done}>{inline(t, p, it.text, { color: it.done ? p.muted : p.fg })}</Text>
                  </Box>
                </Box>
              )
            })}
          </Box>,
        )
        break
      }
      case 'code': {
        const isDiff = /^(diff|patch)$/i.test(b.lang)
        // Rules above and below only, and no indent: selecting the lines copies the code
        // and nothing else (a side border would come along on every line).
        const rule = '─'.repeat(Math.max(4, Math.min(width - 12, Math.max(0, ...b.lines.map(l => l.length)))))
        parts.push(
          <Box flexDirection="column" {...gap}>
            <Box flexDirection="row" gap={1}>
              <Text color={p.muted}>{`──${b.lang ? ` ${b.lang}` : ''}`}</Text>
              {copy && Button && (
                <Button key={`copy-${n}`} plain label="copy" onPress={(press: any) => copy(b.lines.join('\n'), press)} />
              )}
            </Box>
            {b.lines.map(l => (isDiff ? diffLine(t, p, l) : <Text>{highlight(t, p, l, b.lang)}</Text>))}
            <Text color={p.muted}>{rule}</Text>
          </Box>,
        )
        break
      }
      case 'table': {
        const cols = Math.max(b.head.length, ...b.rows.map(r => r.length))
        const natural = Array.from({ length: cols }, (_, c) =>
          Math.max(3, plain(b.head[c] ?? '').length, ...b.rows.map(r => plain(r[c] ?? '').length)),
        )
        const w = fitColumns(natural, width - (3 * cols + 1))
        if (!w) {
          // Too many columns for the window: each row as "header: value" lines.
          parts.push(
            <Box flexDirection="column" {...gap}>
              {b.rows.map((r, ri) => (
                <Box flexDirection="column" marginTop={ri > 0 ? 1 : 0}>
                  {b.head.map((h, c) => (
                    <Text>
                      <Text bold color={p.web}>{plain(h)}: </Text>
                      {inline(t, p, r[c] ?? '', { color: p.fg })}
                    </Text>
                  ))}
                </Box>
              ))}
            </Box>,
          )
          break
        }
        const pad = (s: string, c: number) => ' '.repeat(Math.max(0, w[c]! - s.length))
        const row = (r: string[], isHead: boolean) => {
          const cells = w.map((cw, c) => wrapCell(r[c] ?? '', cw))
          const height = Math.max(1, ...cells.map(l => l.length))
          return Array.from({ length: height }, (_, li) => (
            <Text wrap="truncate">
              {w.map((_, c) => {
                const line = cells[c]![li] ?? ''
                return (
                  <Text>
                    <Text color={p.muted}>{c === 0 ? '│ ' : ' │ '}</Text>
                    {isHead ? <Text bold color={p.web}>{plain(line)}</Text> : inline(t, p, line, { color: p.fg })}
                    <Text>{pad(plain(line), c)}</Text>
                  </Text>
                )
              })}
              <Text color={p.muted}> │</Text>
            </Text>
          ))
        }
        const rule = (l: string, m: string, r: string) => (
          <Text color={p.muted} wrap="truncate">{l + w.map(x => '─'.repeat(x + 2)).join(m) + r}</Text>
        )
        parts.push(
          <Box flexDirection="column" {...gap}>
            {rule('╭', '┬', '╮')}
            {row(b.head, true)}
            {rule('├', '┼', '┤')}
            {b.rows.map((r, ri) => [ri > 0 ? rule('├', '┼', '┤') : null, ...row(r, false)])}
            {rule('╰', '┴', '╯')}
          </Box>,
        )
        break
      }
    }
  })
  return <Box flexDirection="column">{parts}</Box>
}
