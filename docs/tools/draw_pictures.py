"""Draws the README illustrations as terminal-style SVGs.

Every string shown comes from the mods' render code (operator-board/hooks,
persona/hooks); sample data (titles, numbers, times) is made up.
"""
import re
import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)

# tokyo-night, the default persona
T = dict(bg='#1a1b26', panel='#16161e', border='#3b4261', fg='#c0caf5', muted='#737aa2',
         accent='#7aa2f7', ok='#9ece6a', warn='#e0af68', err='#f7768e', read='#7dcfff',
         write='#ff9e64', run='#e0af68', search='#bb9af7', mcp='#73daca')
FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
FS = 14
CW = FS * 0.6  # monospace advance
LH = 21
PAD = 18


def span_svg(x, y, spans):
    """spans: list of (text, colour, flags) where flags may hold b (bold), u (underline)."""
    out = []
    col = 0
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
    total = sum(len(t) for t, _, _ in spans)
    if total <= cols:
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
    """Tiny markup: {colour|flags:text}. Plain text is fg."""
    spans, pos = [], 0
    for m in re.finditer(r'\{(\w+)(?:\|(\w+))?:(.*?)\}', line):
        if m.start() > pos:
            spans.append((line[pos:m.start()], T['fg'], ''))
        spans.append((m.group(3), T.get(m.group(1), m.group(1)), m.group(2) or ''))
        pos = m.end()
    if pos < len(line):
        spans.append((line[pos:], T['fg'], ''))
    return spans


def pane(lines, cols=48, title='operator', caption=None):
    w = int(cols * CW + PAD * 2)
    body_top = 44
    h = body_top + len(lines) * LH + PAD
    parts = [
        f'<rect x="0.5" y="0.5" width="{w-1}" height="{h-1}" rx="10" fill="{T["panel"]}" stroke="{T["border"]}"/>',
        f'<line x1="0" y1="32" x2="{w}" y2="32" stroke="{T["border"]}"/>',
        span_svg(PAD, 22, [(title, T['muted'], 'b')]),
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


# 1. The pane with everything folded: alerts strip, then header summaries.
folded = [
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
]
w, h, inner = pane(folded)
save('operator-pane.svg', w + 40, h + 40, offset(inner, 20, 20),
     'Illustration: the operator pane with every section folded, each header showing a one-line summary')

# 2. Board and PRs opened.
opened = [
    '{warn|b:▾ Board (1 need reply, 2 pending)}',
    '{muted:showing:}  {accent|u:this folder}  {fg|u:all sessions}',
    '',
    '{accent|b:Needs reply (1)}  {fg|u:show context}',
    '1. Merge 0.9.0 into main?',
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
]
w, h, inner = pane(opened)
save('board-and-prs.svg', w + 40, h + 40, offset(inner, 20, 20),
     'Illustration: Board and PRs sections open, with one-click reply and fix CI buttons')

# 3. Bands above the prompt (operator-board, then persona), and the prompt.
cols = 64
band_lines = [
    '{accent|u:board (1 need reply)}  {fg|u:recall}  {fg|u:PRs (3, 1 red)}  {err:●}  {accent|u:● 2 alerts}',
]
pal = ['read', 'write', 'run', 'search', 'accent', 'mcp', 'ok', 'warn', 'err']
persona_line = [('◆ Tokyo Night ', T['accent'], 'b')] + [('●', T[k], '') for k in pal] + \
    [(' /persona to switch', T['muted'], '')]
bw = int(cols * CW + PAD * 2)
rows = []
y = 30
rows.append(span_svg(PAD, y, [('operator-board band', T['muted'], '')]))
rows.append(span_svg(PAD, y + LH, truncate(parse(band_lines[0]), cols)))
rows.append(span_svg(PAD, y + LH * 2.6, [('persona band', T['muted'], '')]))
rows.append(span_svg(PAD, y + LH * 3.6, persona_line))
py = y + LH * 4.6
rows.append(f'<rect x="{PAD-6}" y="{py}" width="{bw - 2*PAD + 12}" height="34" rx="6" fill="none" stroke="{T["border"]}"/>')
rows.append(span_svg(PAD + 4, py + 22, [('> ', T['muted'], ''), ('▌', T['fg'], '')]))
bh = int(py + 34 + PAD)
save('bands.svg', bw, bh, '\n'.join(rows),
     'Illustration: the operator-board and persona bands drawn above the Claude Code prompt')

# 4. The 24 built-in personas.
themes = Path(sys.argv[2]).read_text()
personas = re.findall(r"\{ name: '([a-z-]+)', label: '([^']*)',\s*palette: \{([^}]*)\}", themes)
assert len(personas) == 24, len(personas)
tile_w, tile_h, per_row, gap = 330, 58, 4, 12
tiles = []
for n, (name, label, palette) in enumerate(personas):
    p = dict(re.findall(r"(\w+): '(#[0-9a-fA-F]{6})'", palette))
    x = gap + (n % per_row) * (tile_w + gap)
    y = gap + (n // per_row) * (tile_h + gap)
    tiles.append(f'<rect x="{x}" y="{y}" width="{tile_w}" height="{tile_h}" rx="8" fill="{p["bg"]}" stroke="#3b4261"/>')
    tiles.append(f'<text x="{x+12}" y="{y+23}" fill="{p["web"]}" font-weight="700">{escape("◆ " + label)}</text>')
    for k, key in enumerate(['read', 'write', 'run', 'search', 'web', 'mcp', 'ok', 'warn', 'err']):
        tiles.append(f'<circle cx="{x + 18 + k*16}" cy="{y+41}" r="5.5" fill="{p.get(key, p["fg"])}"/>')
    tiles.append(f'<text x="{x+tile_w-12}" y="{y+45}" fill="{p["muted"]}" font-size="12" text-anchor="end">{escape(name)}</text>')
gw = gap + per_row * (tile_w + gap)
gh = gap + 6 * (tile_h + gap)
save('personas.svg', gw, gh, '\n'.join(tiles),
     'The 24 built-in personas, each on its own background with its accent colours')

# 5. How the pieces fit.
def box(x, y, w, h, title, lines, color):
    s = [f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="8" fill="{T["panel"]}" stroke="{color}"/>',
         f'<text x="{x+14}" y="{y+24}" fill="{color}" font-weight="700">{escape(title)}</text>']
    for i, l in enumerate(lines):
        s.append(f'<text x="{x+14}" y="{y+48+i*20}" fill="{T["fg"]}" font-size="13">{escape(l)}</text>')
    return '\n'.join(s)

def arrow(x1, y1, x2, y2):
    return (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" stroke="{T["muted"]}" stroke-width="1.5" marker-end="url(#a)"/>')

aw, ah = 920, 470
d = [f'<defs><marker id="a" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto">'
     f'<path d="M0,0 L10,5 L0,10 z" fill="{T["muted"]}"/></marker></defs>']
d.append(box(310, 20, 300, 76, 'kg-ng/claude-mods', ['GitHub repo = plugin marketplace', '.claude-plugin/marketplace.json'], T['accent']))
d.append(box(40, 150, 390, 150, 'operator-board  0.14.0', [
    'pane  /operator  (docked, sized to terminal)',
    'band  board · recall · PRs · alerts',
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
d.append(arrow(420, 96, 235, 148))
d.append(arrow(500, 96, 685, 148))
d.append(arrow(235, 300, 390, 358))
d.append(arrow(685, 300, 530, 358))
save('overview.svg', aw, ah, '\n'.join(d), 'How the repo, the two mods and Claude Code fit together')
print('ok', sorted(p.name for p in OUT.iterdir()))
