"""Draws the README's still pictures as terminal-style SVGs, each in a different persona.

Every label comes from the mods' render code (operator-board/hooks, persona/hooks);
sample data (titles, numbers, times) is made up. Colours are the personas' own palettes,
read from persona/hooks/themes.ts, mapped the way operator-board's look.ts maps them
(accent = web, plus ok / warn / err / muted / fg on the persona's background).

    python3 docs/tools/draw_pictures.py docs/images persona/hooks/themes.ts
"""
import re
import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
THEMES = Path(sys.argv[2]).read_text()

FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
FS = 14
CW = FS * 0.6  # monospace advance
LH = 21
PAD = 18
COLS = 48


# ---------- personas ----------

def load_personas(src):
    found = re.findall(r"\{ name: '([a-z-]+)', label: '([^']*)',\s*palette: \{([^}]*)\}", src)
    out = {}
    for name, label, palette in found:
        out[name] = (label, dict(re.findall(r"(\w+): '(#[0-9a-fA-F]{6})'", palette)))
    return out


PERSONAS = load_personas(THEMES)
assert len(PERSONAS) == 24, len(PERSONAS)


def mix(a, b, t):
    """a blended toward b by t (0..1), as #rrggbb."""
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(pa, pb))


T = {}
LABEL = ['']


def use(name):
    """Paint what follows in this persona."""
    label, p = PERSONAS[name]
    fg = p.get('fg', '#c0caf5')
    T.clear()
    T.update(
        bg=p['bg'], fg=fg, muted=p.get('muted', mix(p['bg'], fg, 0.5)),
        accent=p.get('web', fg), ok=p.get('ok', fg), warn=p.get('warn', fg), err=p.get('err', fg),
        read=p.get('read', fg), write=p.get('write', fg), run=p.get('run', fg),
        search=p.get('search', fg), mcp=p.get('mcp', fg),
        panel=mix(p['bg'], fg, 0.035), border=mix(p['bg'], fg, 0.22),
    )
    LABEL[0] = label


# ---------- drawing ----------

def span_svg(x, y, spans):
    out, col = [], 0
    for text, color, flags in spans:
        if not text:
            continue
        attrs = f'fill="{color}"'
        if 'b' in flags:
            attrs += ' font-weight="700"'
        if 'u' in flags:
            attrs += ' text-decoration="underline"'
        out.append(f'<text x="{x + col * CW:.1f}" y="{y}" {attrs} xml:space="preserve">{escape(text)}</text>')
        col += len(text)
    return '\n'.join(out)


def truncate(spans, cols):
    """truncate-end at `cols` columns, as Ink does."""
    if sum(len(t) for t, _, _ in spans) <= cols:
        return spans
    out, left = [], cols - 1
    for t, c, f in spans:
        if left <= 0:
            break
        out.append((t[:left], c, f))
        left -= len(t[:left])
    out.append(('…', out[-1][1], out[-1][2]))
    return out


def parse(line):
    """Tiny markup: {colour|flags:text}, flags b (bold) and u (underline, a button). Plain text is fg."""
    spans, pos = [], 0
    for m in re.finditer(r'\{(\w+)(?:\|(\w+))?:(.*?)\}', line):
        if m.start() > pos:
            spans.append((line[pos:m.start()], T['fg'], ''))
        spans.append((m.group(3), T.get(m.group(1), m.group(1)), m.group(2) or ''))
        pos = m.end()
    if pos < len(line):
        spans.append((line[pos:], T['fg'], ''))
    return spans


def tag():
    """The persona's name, small, so a reader knows which colours they're looking at."""
    return f'persona: {LABEL[0]}'


def pane(lines, cols=COLS, title='operator'):
    w = int(cols * CW + PAD * 2)
    body_top = 44
    h = body_top + len(lines) * LH + PAD
    parts = [
        f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="10" fill="{T["panel"]}" stroke="{T["border"]}"/>',
        f'<line x1="0" y1="32" x2="{w}" y2="32" stroke="{T["border"]}"/>',
        span_svg(PAD, 22, [(title, T['muted'], 'b')]),
        f'<text x="{w - PAD}" y="22" fill="{T["muted"]}" font-size="12" text-anchor="end">{escape(tag())}</text>',
    ]
    for i, line in enumerate(lines):
        if line:
            parts.append(span_svg(PAD, body_top + 14 + i * LH, truncate(parse(line), cols)))
    return w, h, '\n'.join(parts)


def svg(w, h, inner, label):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" '
            f'role="img" aria-label="{escape(label)}" font-family="{FONT}" font-size="{FS}">\n'
            f'<title>{escape(label)}</title>\n<rect width="{w}" height="{h}" rx="12" fill="{T["bg"]}"/>\n'
            f'{inner}\n</svg>\n')


def save(name, w, h, inner, label):
    (OUT / name).write_text(svg(w, h, inner, label))


def offset(inner, dx, dy):
    return f'<g transform="translate({dx},{dy})">\n{inner}\n</g>'


def save_pane(name, persona, rows, label):
    use(persona)
    w, h, inner = pane(rows)
    save(name, w + 40, h + 40, offset(inner, 20, 20), f'{label} (persona: {LABEL[0]})')


# ---------- 1. the folded pane ----------
save_pane('operator-pane.svg', 'dracula', [
    '{warn|b:● Alerts (2)}  {muted|u:dismiss all}',
    '{muted:14:02} Finished, needs your reply: Merge 0.… {muted|u:✓}',
    '{muted:13:47} CI failed: #12 Shorter PR rows        {muted|u:✓}',
    '',
    '{warn|b:▸ Board (1 need reply, 2 pending)}',
    '',
    '{err|b:▸ PRs (3, 1 red · 2 to review)}',
    '',
    '{accent|b:▸ To-do (3 open) · autopilot on}',
    '',
    '{accent|b:▸ Usage · ctx 42% · 5h 30% · wk 12% · $1.20}',
    '',
    '{accent|b:▸ Git · feat/x · 3 changed}         {accent|u:open PR}',
    '',
    '{accent|b:▸ Sessions (8)}',
    '',
    '{accent|b:▸ Quick prompts (3)}',
    '',
    '{accent|b:▸ Recall (120 saved)}',
], 'Illustration: the operator pane with every section folded, each header showing a one-line summary')

# ---------- 2. each section, opened ----------
SECTIONS = {
    'board': ('rose-pine', 'Board: needs reply, pending and recent asks', [
        '{warn|b:▾ Board (1 need reply, 2 pending)}',
        '{muted:showing:}  {accent|u:this folder}  {fg|u:all sessions}',
        '',
        '{accent|b:Needs reply (1)}  {fg|u:show context}',
        '1. Merge 0.9.0 into main?',
        '{muted:   Option 1 now, or wait for the e2e run.}',
        '   {accent|u:reply "yes, merge it"}  {fg|u:done}',
        '',
        '{accent|b:Pending – CI (1)}',
        '1. Waiting on e2e for #12                  {muted|u:✓}',
        '{accent|b:Pending – follow-ups (1)}',
        '1. Fix the SessionEnd hook path            {muted|u:✓}',
        '',
        '{accent|b:Recent asks}',
        '{fg|b:◆ This session · make the panel friendlier}',
        '  {muted:add header summaries}',
        '',
        '{accent|b:◇ fix the login redirect}{muted: · 11:20 · ~/dev/web}',
        '  {muted:why does the callback drop the state param?}',
    ]),
    'todo': ('everforest', 'To-do: the folder\'s list, with autopilot', [
        '{accent|b:▾ To-do (3 open) · autopilot on}',
        '{accent|u:autopilot: on}  {fg|u:stop after 3 ▾}',
        '',
        '{warn:◐} Add review requests to PRs        {muted|u:✓} {muted|u:×}',
        '{accent:○} Write the try-it walkthrough  {muted|u:▶} {muted|u:✓} {muted|u:×}',
        '{accent:○} Shorter PR rows{muted: · by Claude} {muted|u:▶} {muted|u:✓} {muted|u:×}',
        '',
        '{muted:Proposed by Claude:}',
        '{muted:?} Split register.tsx             {accent|u:approve} {muted|u:×}',
        '',
        '{muted:Add  }{border:[}{muted: something to do           }{border:]} {fg|u:add}',
        '',
        '{ok:✓ }{muted:Fix the chime · alerts you can find again}',
        '{ok:✓ }{muted:One-click show pane on narrow terminals}',
        '',
        '{muted:▶ starts an item now. Autopilot starts the next}',
        '{muted:one when Claude finishes, and pauses on a}',
        '{muted:question, your usage warn line, or after the}',
        '{muted:set number in a row.}',
    ]),
    'usage': ('kanagawa', 'Usage: context, 5-hour and weekly limits, cost, advisor calls, tokens by model', [
        '{warn|b:▾ Usage · ctx 42% · 5h 78% · wk 31% · $1.20}',
        'context {ok:████░░░░░░ 42%}{muted: · of 200k}',
        '5-hour  {warn:████████░░ 78%}{muted: · resets in 2h (17:00)}',
        'weekly  {ok:███░░░░░░░ 31%}{muted: · resets Mon 09:00}',
        '{muted:cost this session $1.20}',
        'advisor {muted:2 calls this session · la…}  {fg|u:/advisor}',
        'model   {accent:Opus 5.5}{muted: · 1.2M in · 48k out}  {fg|u:/model}',
        '{muted:        also haiku-5-5 12k in}',
        '',
        '{muted:updated 14:05}  {fg|u:refresh}  {fg|u:time: 24h}',
        '{fg|u:limits 75/90%}  {fg|u:alerts: on}',
        '',
        '{muted:Log  }{border:[}{muted: label, e.g. sprint 23 start  }{border:]}',
        '{muted:Readings are logged at session start and end}',
        '{muted:to ~/.claude/operator-board/usage-log.jsonl.}',
    ]),
    'git': ('one-dark', 'Git: branch, changes, what Claude changed, the next step', [
        '{accent|b:▾ Git · feat/x · 3 changed · CI 3/5}  {accent|u:open PR}',
        '{accent|b:feat/x}{muted: · ↑0 ↓0}{warn: · 3 changed}',
        '{muted:  M  operator-board/hooks/prs.tsx}',
        '{muted:  M  operator-board/hooks/register.tsx}',
        '{muted:  ?? notes.md}',
        'Claude changed 2 files {ok:+48} {err:−6}  {accent|u:review} {fg|u:commit}',
        '{warn:CI 3/5}{muted: on feat/x · no PR yet}',
        'last: 94e1386 Split register.tsx (2 hours ago)',
        '{accent|u:review}  {fg|u:commit}',
        '{muted:run:}  {fg|u:test}  {fg|u:lint}  {fg|u:typecheck}  {fg|u:build}',
        '{muted:updated 14:05}  {fg|u:refresh}',
    ]),
    'sessions': ('nord', 'Sessions: resume, continue from a checkpoint, copy', [
        '{accent|b:▾ Sessions (8)}',
        '{muted:updated 14:05}  {fg|u:refresh}  {accent|u:checkpoint}',
        '{ok:✓ this session} {muted:14:02} README merged; next: personas',
        '',
        '{muted:13:40} make the panel friendlier',
        '  {ok:✓} Sprint 22 closed; next: plan 23',
        '{muted:  ~/dev/claude-mods · 42 msg}',
        '  {accent|u:resume}  {accent|u:continue}  {fg|u:copy cmd}',
        '',
        '{muted:11-21 18:10} fix the login redirect',
        '{muted:  ~/dev/web · 17 msg}  {fg|u:copy cmd}',
        '',
        '{muted:resume reopens a session; continue starts}',
        '{muted:fresh from its checkpoint; copy cmd works}',
        '{muted:from any folder.}',
    ]),
    'quick': ('night-owl', 'Quick prompts: /btw for a side question, pinned prompts, one click to send', [
        '{accent|b:▾ Quick prompts (3)}',
        '{accent:▸ /btw} {muted:a side question, answered without interr…}',
        '{accent:run the tests and fix what fails}         {muted|u:×}',
        '{accent:/code-review}                             {muted|u:×}',
        '{accent:summarise what changed today}             {muted|u:×}',
        '',
        '{muted:Pin  }{border:[}{muted: a prompt you send often     }{border:]} {fg|u:pin}',
        '',
        '{muted:You often send:}',
        'sorry continue                          {fg|u:+ pin}',
        'run the e2e tests                       {fg|u:+ pin}',
        '',
        '{muted:Click a prompt to put it in the prompt box.}',
    ]),
    'prs': ('synthwave', 'PRs: yours, two lines each, and those waiting on your review', [
        '{err|b:▾ PRs (3, 1 red · 2 to review)}',
        '{muted:updated 14:05}  {fg|u:refresh}',
        '',
        '{accent|b:#12 Shorter PR rows} {muted:claude-mods}',
        '  {err:CI red: lint, e2e · 2d}             {accent|u:fix CI}',
        '',
        '{accent|b:#9 Recall search} {muted:claude-mods}',
        '  {warn:2 threads · CI green · 4d}  {accent|u:address threads}',
        '',
        '{ok|b:Ready (1)}',
        '{ok:✓} #11 Alerts you can find… {muted:claude-mods}    {accent|u:merge}',
        '',
        '{accent|b:To review (2)}',
        '#8 Faster recall search {muted:claude-mods · 1d}  {accent|u:review}',
        '#4 Fix the docs links {muted:web · 3d}           {accent|u:review}',
        '',
        '{muted:Click a PR to open it in the browser.}',
    ]),
    'recall': ('solarized-light', 'Recall: search earlier questions and their answers', [
        '{accent|b:▾ Recall (120 saved)}',
        '{muted:Find }{border:[}{fg: merge                       }{border:]} {fg|u:search}',
        '',
        '{muted:3 earlier questions match "merge"}',
        '{muted:11-22 15:20} merge 6',
        '{muted:11-22 14:41} merge 2 and 3',
        '{muted:11-20 10:02} how do I merge into a protected branch?',
        '',
        '{muted:Picking a question shows it with the reply it got.}',
    ]),
}
for key, (persona, label, rows) in SECTIONS.items():
    save_pane(f'section-{key}.svg', persona, rows, f'Illustration: {label}')

# ---------- 3. the bands above the prompt ----------
use('gruvbox')
cols = 64
bw = int(cols * CW + PAD * 2)
y = 30
pal = ['read', 'write', 'run', 'search', 'accent', 'mcp', 'ok', 'warn', 'err']
persona_line = [(f'◆ {LABEL[0]} ', T['accent'], 'b')] + [('●', T[k], '') for k in pal] + \
    [(' /persona to switch', T['muted'], '')]
crew = [
    '{accent|bu:▾ crew 2 running · 1 done}',
    '{accent:●} hunt flaky test{muted: · Explore · haiku · 42s…}  {fg|u:view} {fg|u:msg} {fg|u:stop}',
    '{muted:  ↳ Grep retry in src/**/*.test.ts}',
    '{accent:●} write release notes{muted: · general-purpose · opu…}  {fg|u:view} {fg|u:msg} {fg|u:stop}',
    '{muted:  ↳ Read CHANGELOG.md}',
    '{ok:✓} check CI config{muted: · Explore · 18s · 9k in 1k out}  {fg|u:view}',
    '{muted:  ↳ done}',
]
rows = [
    span_svg(PAD, y, [('operator-board band + crew', T['muted'], '')]),
    span_svg(PAD, y + LH, truncate(parse(
        '{accent|u:board (1 need reply)}  {fg|u:recall}  {fg|u:PRs (3, 1 red)}  {err:●}  {accent|u:● 2 alerts}'), cols)),
]
for i, line in enumerate(crew):
    rows.append(span_svg(PAD, y + LH * (2 + i), truncate(parse(line), cols)))
cy = y + LH * (2 + len(crew))
rows += [
    span_svg(PAD, cy + LH * 0.6, [('persona band', T['muted'], '')]),
    span_svg(PAD, cy + LH * 1.6, persona_line),
]
py = cy + LH * 2.6
rows.append(f'<rect x="{PAD-6}" y="{py}" width="{bw - 2*PAD + 12}" height="34" rx="6" fill="none" stroke="{T["border"]}"/>')
rows.append(span_svg(PAD + 4, py + 22, [('> ', T['muted'], ''), ('▌', T['fg'], '')]))
rows.append(f'<text x="{bw - PAD}" y="{y}" fill="{T["muted"]}" font-size="12" text-anchor="end">{escape(tag())}</text>')
save('bands.svg', bw, int(py + 34 + PAD), '\n'.join(rows),
     f'Illustration: the operator-board and persona bands above the Claude Code prompt (persona: {LABEL[0]})')

# ---------- 4. the 24 built-in personas ----------
use('tokyo-night')
tile_w, tile_h, per_row, gap = 330, 58, 4, 12
tiles = []
for n, (name, (label, p)) in enumerate(PERSONAS.items()):
    x = gap + (n % per_row) * (tile_w + gap)
    y = gap + (n // per_row) * (tile_h + gap)
    tiles.append(f'<rect x="{x}" y="{y}" width="{tile_w}" height="{tile_h}" rx="8" fill="{p["bg"]}" stroke="#3b4261"/>')
    tiles.append(f'<text x="{x+12}" y="{y+23}" fill="{p["web"]}" font-weight="700">{escape("◆ " + label)}</text>')
    for k, key in enumerate(['read', 'write', 'run', 'search', 'web', 'mcp', 'ok', 'warn', 'err']):
        tiles.append(f'<circle cx="{x + 18 + k*16}" cy="{y+41}" r="5.5" fill="{p.get(key, p["fg"])}"/>')
    tiles.append(f'<text x="{x+tile_w-12}" y="{y+45}" fill="{p["muted"]}" font-size="12" text-anchor="end">{escape(name)}</text>')
save('personas.svg', gap + per_row * (tile_w + gap), gap + 6 * (tile_h + gap), '\n'.join(tiles),
     'The 24 built-in personas, each on its own background with its accent colours')

# ---------- 5. how the pieces fit ----------
use('tokyo-night')


def box(x, y, w, h, title, lines, color):
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{T["panel"]}" stroke="{color}"/>',
         f'<text x="{x+14}" y="{y+24}" fill="{color}" font-weight="700">{escape(title)}</text>']
    for i, l in enumerate(lines):
        s.append(f'<text x="{x+14}" y="{y+48+i*20}" fill="{T["fg"]}" font-size="13">{escape(l)}</text>')
    return '\n'.join(s)


def arrow(x1, y1, x2, y2):
    return f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{T["muted"]}" stroke-width="1.5" marker-end="url(#a)"/>'


d = [f'<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
     f'<path d="M0,0 L10,5 L0,10 z" fill="{T["muted"]}"/></marker></defs>']
d.append(box(310, 20, 300, 76, 'kg-ng/claude-mods', ['GitHub repo = plugin marketplace', '.claude-plugin/marketplace.json'], T['accent']))
d.append(box(40, 150, 390, 150, 'operator-board  0.18.0', [
    'pane  /operator  (docked, sized to terminal)',
    'band  board · recall · PRs · alerts · crew',
    'tools  board_update · todo_update',
    '       checkpoint_save',
    'cmds  /board /prs /sessions /quick ...'], T['warn']))
d.append(box(490, 150, 390, 150, 'persona  0.7.1', [
    '24 built-in themes + your own .json',
    'replies, tool-row icons, spinner words',
    'terminal colours (16 ANSI + bg/fg)',
    'band + animated scene while working',
    'tool  design   cmd  /persona'], T['search']))
d.append(box(240, 360, 440, 90, 'Claude Code', [
    'claude plugin marketplace add kg-ng/claude-mods',
    'claude plugin install <mod>@claude-mods'], T['ok']))
d += [arrow(420, 96, 235, 148), arrow(500, 96, 685, 148), arrow(235, 300, 390, 358), arrow(685, 300, 530, 358)]
d.append(box(40, 490, 470, 104, 'copilot/operator-board', [
    'GitHub Copilot CLI extension (no pane)',
    'tools  board_update · todo_update · checkpoint_save',
    'cmds  /board /todo /savepoint · status line'], T['mcp']))
d.append(f'<line x1="90" y1="300" x2="90" y2="488" stroke="{T["muted"]}" stroke-width="1.5" stroke-dasharray="5 4"/>')
d.append(f'<text x="100" y="398" fill="{T["muted"]}" font-size="12">shares</text>')
d.append(f'<text x="100" y="414" fill="{T["muted"]}" font-size="12">~/.claude/</text>')
d.append(f'<text x="100" y="430" fill="{T["muted"]}" font-size="12">operator-board/</text>')
save('overview.svg', 920, 614, '\n'.join(d), 'How the repo, the two mods, the Copilot CLI port and Claude Code fit together')
# ---------- 6. the smaller mods, each in a Claude Code window ----------

def save_term(name, persona, rows, label, cols=64):
    use(persona)
    w, h, inner = pane(rows, cols, title='Claude Code')
    save(name, w + 40, h + 40, offset(inner, 20, 20), f'{label} (persona: {LABEL[0]})')


save_term('guard.svg', 'tokyo-night', [
    '{run:▶} {fg:Bash} {muted:git push origin main}',
    '  {err:✗ guard: `main` is protected: push a branch of your}',
    '  {err:  own and open a PR (git switch -c <name> …).}',
    '',
    '{run:▶} {fg:Bash} {muted:git switch -c fix/login && git push -u origin fix/login}',
    "  {ok:✓} {muted:branch 'fix/login' set up to track 'origin/fix/login'}",
    '',
    '{run:▶} {fg:Bash} {muted:rm -rf "$OUT_DIR"/}',
    '  {err:✗ guard: rm -rf on a path from a variable ($OUT_DIR),}',
    '  {err:  which could be empty or anything.}',
    '',
    '{run:▶} {fg:Bash} {muted:git commit -m "Fix the login redirect"}',
    '  {ok:✓} {muted:[fix/login 3e1f0a2] Fix the login redirect}',
    '{muted:  guard removed the Claude co-author line}',
], 'Illustration: guard stopping a push to main and an rm -rf on a variable, letting a new branch through')

save_term('diff-cards.svg', 'one-dark', [
    '{write:✎} {fg:Edit} {muted:operator-board/hooks/prs.tsx}',
    '  {ok:+12} {err:−18}{muted: · 2 hunks}  {fg|u:show diff ▾}',
    '',
    '{write:✎} {fg:Write} {muted:operator-board/hooks/crew.tsx}',
    '  {muted:new file · }{ok:+236}  {fg|u:show diff ▾}',
    '',
    '{write:✎} {fg:Edit} {muted:README.md}',
    '  {ok:+8} {err:−3}{muted: · 1 hunk}  {fg|u:hide diff ▴}',
    '  {muted:104 }  ### The band',
    '  {muted:105 }{err:- A row above the prompt with shortcuts into the pane.}',
    '  {muted:105 }{ok:+ A row above the prompt with shortcuts into the pane:}',
    '  {muted:106 }{ok:+ the board, recall, PRs and the alert count.}',
    '  {muted:107 }{ok:+ While subagents run, the crew shows under it.}',
    '  {muted:     … 6 more lines}',
], 'Illustration: two edits folded to one line each, and one unfolded to its diff')

save_term('turn-meter.svg', 'kanagawa', [
    '{muted:> make the PR rows shorter}',
    '{accent:⏺} Each PR now takes two lines.',
    '{muted:✻ Baked for 42s · 180k in · 3.1k out · $0.41}',
    '',
    '{muted:> now add a test for it}',
    '{accent:⏺} Added prs.test.tsx; 41 pass.',
    '{muted:✻ Simmered for 1m 12s}{warn: · 1.4M in · 9.8k out · $1.92}',
    '',
    '{muted:> commit it}',
    '{accent:⏺} Committed 3e1f0a2.',
    '{muted:✻ Brewed for 6s · 41k in · 220 out · $0.04}',
], 'Illustration: three turns\' closing lines with their tokens and cost, one in amber')

print('ok', sorted(p.name for p in OUT.glob('*.svg')))
