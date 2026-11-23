"""Draws the README's animations and wide pictures, each in a persona's colours.

The strings drawn come from the mods' render code (labels, alert texts, headers, the persona
picker); the sample data is made up. Animations use CSS keyframes only (no script), so GitHub
plays them in <img>. With reduced motion on, each shows one step, still.

    python3 docs/tools/draw_animations.py docs/images persona/hooks/themes.ts
"""
import re
import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1])
THEMES = Path(sys.argv[2]).read_text()


def load_personas(src):
    found = re.findall(r"\{ name: '([a-z-]+)', label: '([^']*)',\s*palette: \{([^}]*)\}", src)
    return {n: (l, dict(re.findall(r"(\w+): '(#[0-9a-fA-F]{6})'", p))) for n, l, p in found}


def load_extras(src):
    """Each persona's tool icons, spinner frames and spinner words."""
    icons = {n: dict(re.findall(r"(\w+): '([^']*)'", body))
             for n, body in re.findall(r"^  '?([a-z-]+)'?: \{ icons: \{([^}]*)\}", src, re.M)}
    frames = {n: re.findall(r"'([^']*)'", body)
              for n, body in re.findall(r"^  '?([a-z-]+)'?: \{ icons: \{[^}]*\}, frames: \[([^\]]*)\]", src, re.M)}
    words = {n: re.findall(r"'([^']*)'", body)
             for n, body in re.findall(r"\{ name: '([a-z-]+)'.*?spinner: \[([^\]]*)\]", src, re.S)}
    return icons, frames, words


PERSONAS = load_personas(THEMES)
ICONS, FRAMES, WORDS = load_extras(THEMES)


def mix(a, b, t):
    pa = [int(a[i:i + 2], 16) for i in (1, 3, 5)]
    pb = [int(b[i:i + 2], 16) for i in (1, 3, 5)]
    return '#' + ''.join(f'{round(x + (y - x) * t):02x}' for x, y in zip(pa, pb))


T = {}
LABEL = ['']


def use(name):
    """Paint what follows in this persona (accent = web, as operator-board's look.ts maps it)."""
    label, p = PERSONAS[name]
    fg = p.get('fg', '#c0caf5')
    T.clear()
    T.update(
        bg=p['bg'], fg=fg, muted=p.get('muted', mix(p['bg'], fg, 0.5)), accent=p.get('web', fg),
        ok=p.get('ok', fg), warn=p.get('warn', fg), err=p.get('err', fg), read=p.get('read', fg),
        write=p.get('write', fg), run=p.get('run', fg), search=p.get('search', fg), mcp=p.get('mcp', fg),
        panel=mix(p['bg'], fg, 0.035), chat=p['bg'], border=mix(p['bg'], fg, 0.22), banner=mix(p['bg'], fg, 0.1),
    )
    LABEL[0] = label


def icons_of(name):
    return {**{'read': '◇', 'write': '✎', 'run': '▶', 'search': '⌕', 'web': '◎', 'mcp': '◆'}, **ICONS.get(name, {})}
FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
FS = 13
CW = FS * 0.6
LH = 19
SPEED = 1.5  # play speed against the first cut (16s and 12s cycles): 1.5 is 50% faster
CYCLE = round(16 / SPEED, 2)  # seconds for the four steps

W, H = 980, 560
CHAT_X, CHAT_W = 20, 540
PANE_X = 580
PANE_W = W - PANE_X - 20
TOP = 52           # below the title bar
PROMPT_Y = 420     # the prompt box
CAP_Y = 492        # the caption strip


def parse(line):
    spans, pos = [], 0
    for m in re.finditer(r'\{(\w+)(?:\|(\w+))?:(.*?)\}', line):
        if m.start() > pos:
            spans.append((line[pos:m.start()], T['fg'], ''))
        spans.append((m.group(3), T.get(m.group(1), m.group(1)), m.group(2) or ''))
        pos = m.end()
    if pos < len(line):
        spans.append((line[pos:], T['fg'], ''))
    return spans


def text(x, y, line, size=FS):
    out, col = [], 0
    cw = size * 0.6
    for t, c, f in parse(line):
        if not t:
            continue
        a = f'fill="{c}"'
        if 'b' in f:
            a += ' font-weight="700"'
        if 'u' in f:
            a += ' text-decoration="underline"'
        if size != FS:
            a += f' font-size="{size}"'
        out.append(f'<text x="{x + col * cw:.1f}" y="{y}" {a} xml:space="preserve">{escape(t)}</text>')
        col += len(t)
    return '\n'.join(out)


def lines(x, y, rows):
    return '\n'.join(text(x, y + i * LH, r) for i, r in enumerate(rows) if r)


def step(n, inner, also=()):
    """A group shown during step n (1-4) and any steps in `also`."""
    cls = ' '.join(f's{k}' for k in (n, *also))
    return f'<g class="st {cls}">\n{inner}\n</g>'


def css():
    # Each step holds for a quarter of the cycle with a short fade.
    q = 100 / 4
    rules = []
    for k in range(1, 5):
        a, b = (k - 1) * q, k * q
        rules.append(
            f'@keyframes k{k}{{0%{{opacity:{1 if k == 1 else 0}}}'
            f'{max(a - 0.01, 0):.2f}%{{opacity:{1 if k == 1 else 0}}}{a + 1.5:.2f}%{{opacity:1}}'
            f'{b - 1.5:.2f}%{{opacity:1}}{b:.2f}%{{opacity:0}}100%{{opacity:0}}}}'
        )
    sel = []
    for k in range(1, 5):
        sel.append(f'.s{k}{{animation:k{k} {CYCLE}s linear infinite}}')
    # A group in several steps: union of their keyframes, written out per combination used.
    return '\n'.join(rules + sel)


def combo_css(groups):
    """Keyframes for groups shown across several steps (e.g. steps 2 and 3)."""
    q = 100 / 4
    out = []
    for steps in sorted(groups):
        name = 'c' + ''.join(map(str, steps))
        frames = ['0%{opacity:' + ('1' if 1 in steps else '0') + '}']
        for k in range(1, 5):
            a, b = (k - 1) * q, k * q
            on = k in steps
            prev = (k - 1) in steps
            nxt = (k + 1) in steps
            if on and not prev:
                frames.append(f'{max(a - 0.01, 0):.2f}%{{opacity:{1 if k == 1 else 0}}}')
                frames.append(f'{a + 1.5:.2f}%{{opacity:1}}')
            if on and not nxt:
                frames.append(f'{b - 1.5:.2f}%{{opacity:1}}')
                frames.append(f'{b:.2f}%{{opacity:0}}')
        frames.append('100%{opacity:' + ('1' if 4 in steps and 1 in steps else '0') + '}')
        out.append(f'@keyframes {name}{{{"".join(frames)}}}')
        out.append(f'.{name}{{animation:{name} {CYCLE}s linear infinite}}')
    return '\n'.join(out)


def multi(steps, inner):
    name = 'c' + ''.join(map(str, steps))
    return f'<g class="st {name}">\n{inner}\n</g>', tuple(steps)


def frame(title, h=H, has_caption=True, pane_title='operator'):
    bottom = (CAP_Y if has_caption else h) - 18
    return '\n'.join([
        f'<rect width="{W}" height="{h}" rx="14" fill="{T["bg"]}"/>',
        f'<rect x="0.5" y="0.5" width="{W-1}" height="{h-1}" rx="14" fill="none" stroke="{T["border"]}"/>',
        ''.join(f'<circle cx="{22 + i*18}" cy="20" r="6" fill="{c}"/>' for i, c in enumerate(['#f7768e', '#e0af68', '#9ece6a'])),
        text(W / 2 - len(title) * CW / 2, 25, '{muted:' + title + '}'),
        f'<text x="{W - 18}" y="25" fill="{T["muted"]}" font-size="12" text-anchor="end">persona: {escape(LABEL[0])}</text>',
        f'<line x1="0" y1="38" x2="{W}" y2="38" stroke="{T["border"]}"/>',
        # the pane
        f'<rect x="{PANE_X}" y="{TOP}" width="{PANE_W}" height="{bottom - TOP}" rx="8" fill="{T["panel"]}" stroke="{T["border"]}"/>',
        text(PANE_X + 14, TOP + 20, '{muted|b:' + pane_title + '}'),
        f'<line x1="{PANE_X}" y1="{TOP + 30}" x2="{PANE_X + PANE_W}" y2="{TOP + 30}" stroke="{T["border"]}"/>',
        # the prompt
        f'<rect x="{CHAT_X}" y="{PROMPT_Y}" width="{CHAT_W}" height="34" rx="6" fill="none" stroke="{T["border"]}"/>',
        # caption strip
        f'<line x1="0" y1="{CAP_Y}" x2="{W}" y2="{CAP_Y}" stroke="{T["border"]}"/>' if has_caption else '',
    ])


def caption(n, words):
    dots = ''.join(
        f'<circle cx="{W - 110 + i * 22}" cy="{CAP_Y + 34}" r="5" fill="{T["accent"] if i + 1 == n else T["border"]}"/>'
        for i in range(4)
    )
    return step(n, text(24, CAP_Y + 39, f'{{accent|b:{n}}}  {words}', size=15) + dots)


def pane_rows(rows):
    return lines(PANE_X + 14, TOP + 52, rows)


def chat_rows(rows):
    return lines(CHAT_X + 4, TOP + 20, rows)


def band(row):
    return text(CHAT_X + 4, PROMPT_Y - 14, row)


def prompt(t):
    return text(CHAT_X + 14, PROMPT_Y + 22, t)


def banner(title, body, steps):
    """A system notification sliding in at the top right."""
    # In the chat column's empty space, so it never covers the pane it points to.
    x, y, w, h = CHAT_X + CHAT_W - 384, 300, 380, 62
    name = 'b' + ''.join(map(str, steps))
    q = 100 / 4
    a, b = (min(steps) - 1) * q, max(steps) * q
    kf = (f'@keyframes {name}{{0%,{a:.2f}%{{transform:translateX(420px);opacity:0}}'
          f'{a + 3:.2f}%{{transform:translateX(0);opacity:1}}{b - 2:.2f}%{{transform:translateX(0);opacity:1}}'
          f'{b:.2f}%,100%{{transform:translateX(420px);opacity:0}}}}'
          f'.{name}{{animation:{name} {CYCLE}s ease-out infinite}}')
    g = (f'<g class="st {name}">'
         f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="12" fill="{T["banner"]}" stroke="{T["accent"]}"/>'
         f'<circle cx="{x + 28}" cy="{y + 31}" r="15" fill="{T["accent"]}"/>'
         + text(x + 21, y + 36, '{bg|b:♪}')
         + text(x + 54, y + 25, '{fg|b:' + title + '}')
         + text(x + 54, y + 45, body)
         + '</g>')
    return g, kf


def svg(title, label, parts, extra_css, combos):
    style = css() + '\n' + combo_css(combos) + '\n' + extra_css + '\n' + (
        '.st{opacity:0}\n'
        '@media (prefers-reduced-motion: reduce){.st{animation:none!important;opacity:0;transform:none!important}'
        '.rm{opacity:1}}'
    )
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" '
            f'role="img" aria-label="{escape(label)}" font-family="{FONT}" font-size="{FS}">\n'
            f'<title>{escape(label)}</title>\n<style>\n{style}\n</style>\n'
            + frame(title) + '\n' + '\n'.join(parts) + '\n</svg>\n')


def rm(group):
    """Marks a group as the still frame shown with reduced motion."""
    return group.replace('<g class="st ', '<g class="st rm ', 1)


# ---------- 1. how an alert works ----------
use('tokyo-night')
parts, combos, extra = [], set(), ''
folded = ['{accent|b:▸ PRs (2)}', '', '{accent|b:▸ Git · main · clean}', '', '{accent|b:▸ To-do (3 open)}', '',
          '{accent|b:▸ Usage · ctx 42% · 5h 30%}']
ask_chat = ['{muted:> make the panel friendlier}', '',
            '{accent:●} Done: header summaries, PR buttons, board order.', '',
            '{mcp:⬢} {fg:board_update}  {muted:add reply "Merge 0.9.0 into main?"}', '',
            '{accent:●} Should I merge 0.9.0 into main?']
g, c = multi((1, 2, 3), chat_rows(ask_chat)); parts.append(rm(g)); combos.add(c)
parts.append(step(4, chat_rows(ask_chat + ['', '{muted:> yes, merge it}', '',
                                          '{mcp:⬢} {fg:board_update}  {muted:remove r1}', '',
                                          '{accent:●} Merged 0.9.0 into main.'])))
# pane
parts.append(step(1, pane_rows(['{accent|b:▸ Board}', ''] + folded)))
parts.append(step(2, pane_rows(['{warn|b:● Alerts (1)}  {muted|u:dismiss all}',
                                '{muted:14:02} Finished, needs your reply: Merg… {muted|u:✓}', '',
                                '{warn|b:▸ Board (1 need reply)}', ''] + folded)))
parts.append(rm(step(3, pane_rows(['{warn|b:● Alerts (1)}  {muted|u:dismiss all}',
                                   '{muted:14:02} Finished, needs your reply: Merg… {muted|u:✓}', '',
                                   '{warn|b:▾ Board (1 need reply)}',
                                   '{accent|b:Needs reply (1)}',
                                   '1. Merge 0.9.0 into main?',
                                   '   {accent|u:reply "yes, merge it"}  {fg|u:done}', ''] + folded[:3]))))
parts.append(step(4, pane_rows(['{accent|b:▾ Board}', '{muted:Nothing waiting on you.}', ''] + folded)))
# band and prompt
quiet = '{fg|u:board}  {fg|u:recall}  {fg|u:PRs (2)}'
loud = '{accent|u:board (1 need reply)}  {fg|u:recall}  {fg|u:PRs (2)}  {accent|u:● 1 alert}'
parts.append(step(1, band(quiet)))
g, c = multi((2, 3), band(loud)); parts.append(rm(g)); combos.add(c)
parts.append(step(4, band(quiet)))
g, c = multi((1, 2), prompt('{muted:>} ▌')); parts.append(g); combos.add(c)
parts.append(rm(step(3, prompt('{muted:>} yes, merge it▌'))))
parts.append(step(4, prompt('{muted:>} ▌')))
b, kf = banner('Claude · claude-mods', 'Finished, needs your reply: Merge 0.9.0…', (2, 3)); parts.append(b); extra += kf
parts += [caption(1, 'Claude finishes a turn with a question for you'),
          caption(2, 'A chime, and a notification named after the folder'),
          rm(caption(3, 'It waits in the pane: reply fills your answer in')),
          caption(4, 'You answer, and the alert clears itself')]
(OUT / 'alerts-flow.svg').write_text(svg('claude-mods — Claude Code', 'Animation: how an operator-board alert works, in four steps', parts, extra, combos))

# ---------- 2. from an edit to a merge ----------
use('github-dark')
parts, combos, extra = [], set(), ''
edit_chat = ['{muted:> add a line to notes.md on a new branch, try-panel}', '',
             '{run:❯} {fg:git switch -c try-panel}', '',
             '{write:✎} {fg:Edit notes.md}  {ok:+1}', '',
             '{accent:●} Added the line on try-panel.']
g, c = multi((1, 2), chat_rows(edit_chat)); parts.append(g); combos.add(c)
parts.append(rm(step(3, chat_rows(edit_chat[:6] + ['{run:❯} {fg:git push -u origin try-panel}', '',
                                                    '{run:❯} {fg:gh pr create}', '',
                                                    '{accent:●} Opened #11, CI is running.']))))
parts.append(step(4, chat_rows(edit_chat[:6] + ['{run:❯} {fg:git push -u origin try-panel}', '',
                                                 '{run:❯} {fg:gh pr create}', '',
                                                 '{accent:●} Opened #11, CI is running.'])))
git_open = ['{accent|b:▾ Git · try-panel · 1 changed}        {accent|u:push}',
            '{accent|b:try-panel} {muted:· not pushed} {warn:· 1 changed}',
            '{muted:  M notes.md}',
            'Claude changed 1 file {ok:+1} {err:−0}   {accent|u:review}  {fg|u:commit}', '']
g, c = multi((1, 2), pane_rows(git_open + ['{accent|b:▸ PRs (0)}', '', '{accent|b:▸ Board}'])); parts.append(g); combos.add(c)
parts.append(rm(step(3, pane_rows(['{accent|b:▸ Git · try-panel · clean}', '',
                                   '{warn|b:▾ PRs (1)}', '{muted:updated 14:20}  {fg|u:refresh}', '',
                                   '{accent|b:#11 Try the panel} {muted:claude-mods}',
                                   '  {warn:CI 2/5 · 1m}', '', '{accent|b:▸ Board}']))))
parts.append(step(4, pane_rows(['{warn|b:● Alerts (1)}  {muted|u:dismiss all}',
                                '{muted:14:21} CI passed: #11 Try the panel       {muted|u:✓}', '',
                                '{accent|b:▸ Git · try-panel · clean}', '',
                                '{accent|b:▾ PRs (1)}', '{muted:updated 14:21}  {fg|u:refresh}', '',
                                '{ok|b:Ready (1)}',
                                '{ok:✓} #11 Try the panel {muted:claude-mods}      {accent|u:merge}'])))
parts.append(step(1, prompt('{muted:>} ▌')))
parts.append(step(2, prompt('{muted:>} Push the branch try-panel and set its upstream.▌')))
parts.append(rm(step(3, prompt('{muted:>} ▌'))))
parts.append(step(4, prompt('{muted:>} Merge kg-ng/claude-mods#11 (https://github.com/…)▌')))
parts.append(step(1, band('{fg|u:board}  {fg|u:recall}  {fg|u:PRs (0)}')))
g, c = multi((2, 3), band('{fg|u:board}  {fg|u:recall}  {fg|u:PRs (1)}')); parts.append(rm(g)); combos.add(c)
parts.append(step(4, band('{fg|u:board}  {fg|u:recall}  {fg|u:PRs (1)}  {accent|u:● 1 alert}')))
b, kf = banner('Claude · claude-mods', 'CI passed: #11 Try the panel', (4,)); parts.append(b); extra += kf
parts += [caption(1, 'Claude edits a file: Git shows what it changed'),
          caption(2, 'push fills the prompt; Enter runs it'),
          rm(caption(3, 'open PR the same way: CI starts on it')),
          caption(4, 'CI goes green: an alert, and a merge button')]
(OUT / 'dev-flow.svg').write_text(svg('claude-mods — Claude Code', 'Animation: from an edit to a merge with operator-board, in four steps', parts, extra, combos))


# ---------- 2b. the to-do list with autopilot ----------
use('everforest')
parts, combos, extra = [], set(), ''
todo_head = '{accent|b:▾ To-do (2 open)}'
items = ['{accent:○} Write the try-it walkthrough {muted|u:▶} {muted|u:✓} {muted|u:×}',
         '{accent:○} Shorter PR rows{muted: · by Claude} {muted|u:▶} {muted|u:✓} {muted|u:×}']
propose_chat = ['{muted:> the PR rows are too tall, and register.tsx is huge}', '',
                '{accent:●} Shortened the PR rows to two lines.', '',
                '{mcp:⬢} {fg:todo_update}  {muted:add "Split register.tsx"}', '',
                '{accent:●} I added a to-do to split register.tsx',
                '  {accent:for later. Approve it in the pane.}']
g, c = multi((1, 2), chat_rows(propose_chat)); parts.append(g); combos.add(c)
work_chat_rows = ['{muted:[to-do] Work on item t3: "Split register.tsx"}', '',
                  '{read:◇} {fg:Read} {muted:operator-board/hooks/register.tsx}',
                  '{write:✎} {fg:Write} {muted:operator-board/hooks/crew.tsx}  {ok:+236}',
                  '{run:▶} {fg:Bash} {muted:claude plugin test .}  {ok:48 pass}']
parts.append(rm(step(3, chat_rows(work_chat_rows))))
parts.append(step(4, chat_rows(work_chat_rows + ['', '{mcp:⬢} {fg:todo_update}  {muted:done t3 "48 tests pass"}', '',
                                                 '{muted:[to-do] Work on item t1: "Write the try-it…"}',
                                                 '{read:◇} {fg:Read} {muted:README.md}'])))
# pane
parts.append(step(1, pane_rows([todo_head, '{fg|u:autopilot: off}', ''] + items +
                               ['', '{muted:Proposed by Claude:}',
                                '{muted:?} Split register.tsx           {accent|u:approve} {muted|u:×}'])))
parts.append(step(2, pane_rows(['{accent|b:▾ To-do (3 open) · autopilot on}', '{accent|u:autopilot: on}  {fg|u:stop after 3 ▾}', ''] + items +
                               ['{accent:○} Split register.tsx       {muted|u:▶} {muted|u:✓} {muted|u:×}'])))
parts.append(rm(step(3, pane_rows(['{accent|b:▾ To-do (3 open) · autopilot on}', '{accent|u:autopilot: on}  {fg|u:stop after 3 ▾}', '',
                                   '{warn:◐} Split register.tsx{muted: · doing}', ''] + items))))
parts.append(step(4, pane_rows(['{accent|b:▾ To-do (2 open) · autopilot on}', '{accent|u:autopilot: on}  {fg|u:stop after 3 ▾}', '',
                                '{warn:◐} Write the try-it walkthrough{muted: · doing}',
                                items[1], '',
                                '{ok:✓ }{muted:Split register.tsx · 48 tests pass}'])))
parts.append(step(1, prompt('{muted:>} ▌')))
parts.append(step(2, prompt('{muted:>} ▌')))
parts.append(rm(step(3, prompt('{muted:>} ▌'))))
parts.append(step(4, prompt('{muted:>} ▌')))
parts.append(step(1, band('{fg|u:board}  {fg|u:recall}  {fg|u:PRs (1)}')))
g, c = multi((2, 3, 4), band('{fg|u:board}  {fg|u:recall}  {fg|u:PRs (1)}  {accent:autopilot ▶}')); parts.append(rm(g)); combos.add(c)
parts += [caption(1, 'Claude proposes a to-do; it waits for your approve'),
          caption(2, 'Approve it, and turn autopilot on'),
          rm(caption(3, 'Autopilot starts the next item: Claude works on it')),
          caption(4, 'Done with how Claude knows; the next one starts')]
(OUT / 'todo-flow.svg').write_text(svg('claude-mods — Claude Code', 'Animation: the operator-board to-do list with autopilot, in four steps', parts, extra, combos))


def wrap_svg(w, h, label, body, style=''):
    css_block = f'<style>\n{style}\n</style>\n' if style else ''
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
            f'aria-label="{escape(label)}" font-family="{FONT}" font-size="{FS}">\n<title>{escape(label)}</title>\n'
            f'{css_block}{body}\n</svg>\n')


def work_chat(name):
    """Claude at work, drawn the way persona draws it: its tool icons, its spinner."""
    ic = icons_of(name)
    frame0 = (FRAMES.get(name) or ['✻'])[0]
    word = (WORDS.get(name) or ['Working'])[0]
    return [
        '{muted:> make the PR rows shorter}',
        '',
        '{read:' + ic['read'] + '} {fg:Read} {muted:operator-board/hooks/prs.tsx}',
        '{write:' + ic['write'] + '} {fg:Edit} {muted:operator-board/hooks/prs.tsx} {ok:+12} {err:−18}',
        '{run:' + ic['run'] + '} {fg:Bash} {muted:claude plugin test .}  {ok:39 pass}',
        '',
        '{accent|b:## Shorter PR rows}',
        'Each PR now takes {fg|b:two lines}: the title, then',
        '{read:CI red: lint · 2d} with its {accent:fix CI} button.',
        '',
        '{muted:' + frame0 + ' ' + word + '…}',
    ]


def persona_band(label):
    sw = ''.join('{' + c + ':●}' for c in ['read', 'write', 'run', 'search', 'accent', 'mcp', 'ok', 'warn', 'err'])
    return '{accent|b:◆ ' + label + '} ' + sw + ' {muted:/persona to switch}'


# ---------- 3. picking a persona: the whole window recolours ----------
PICKS = ['dracula', 'nord', 'gruvbox']
LIST = list(PERSONAS)[:10]  # the picker lists the built-ins in this order
PCYCLE = round(12 / SPEED, 2)


def picker_scene(name, k):
    """The window once `name` is picked: chat, band, picker and terminal in its colours."""
    use(name)
    label = LABEL[0]
    word = (WORDS.get(name) or ['Working'])[0]
    out = [frame('claude-mods — Claude Code', pane_title='Pick a persona')]
    out.append(chat_rows(['{muted:> /persona}', ''] + work_chat(name)[2:]))
    out.append(text(CHAT_X + 4, PROMPT_Y - 14, persona_band(label)))
    out.append(prompt('{muted:>} ▌'))
    x0, y0 = PANE_X + 14, TOP + 62
    out.append(f'<rect x="{x0 - 6}" y="{y0 - 18}" width="{PANE_W - 16}" height="70" rx="8" fill="none" stroke="{T["accent"]}"/>')
    out.append(text(x0 + 4, y0, '{accent|b:' + label + '}'))
    out.append(text(x0 + 4, y0 + 19, '{read:◇ Read} {write:✎ Edit} {run:▶ Bash} {search:⌕ Grep} {accent:◎ Web} {mcp:◆ MCP}'))
    out.append(text(x0 + 4, y0 + 38, '{fg:Body text} {muted:muted} {ok:✓ ok} {warn:! warn} {err:✗ error} {muted:' + word + '…}'))
    out.append(text(x0, y0 + 74, '{muted:now: terminal ' + label + ' · chat ' + label + '}'))
    for i, n in enumerate(LIST):
        nl, np_ = PERSONAS[n]
        y = y0 + 98 + i * LH
        if n == name:
            out.append(f'<rect x="{x0 - 6}" y="{y - 14}" width="{PANE_W - 16}" height="{LH}" rx="4" fill="{mix(T["bg"], T["accent"], 0.2)}"/>')
        sw = ''.join(f'<tspan fill="{np_.get(c, np_["fg"])}">■</tspan>' for c in ['read', 'write', 'run', 'search', 'web', 'ok', 'err'])
        out.append(f'<text x="{x0}" y="{y}" xml:space="preserve"><tspan fill="{T["fg"]}">{"● " if n == name else "  "}</tspan>{sw}'
                   f'<tspan fill="{T["fg"] if n == name else T["muted"]}" font-weight="{700 if n == name else 400}">  {escape(nl)}</tspan></text>')
    out.append(text(x0, y0 + 98 + len(LIST) * LH + 4, '{muted:↑/↓ preview · Enter pick · Esc close}'))
    dots = ''.join(f'<circle cx="{W - 88 + i * 22}" cy="{CAP_Y + 34}" r="5" fill="{T["accent"] if i == k else T["border"]}"/>'
                   for i in range(len(PICKS)))
    out.append(text(24, CAP_Y + 39, '{accent|b:/persona} → {accent|b:' + label + '}: chat, tool icons, band and terminal follow', size=15) + dots)
    return '\n'.join(out)


n_ = len(PICKS)
q_ = 100 / n_
kf, groups = [], []
for k, name in enumerate(PICKS):
    a, b = k * q_, (k + 1) * q_
    if k == 0:  # shown from the start; fades out as the next fades in
        frames_ = f'0%,{b - 3:.2f}%{{opacity:1}}{b:.2f}%,{100 - 3:.2f}%{{opacity:0}}100%{{opacity:1}}'
    else:
        frames_ = (f'0%,{a - 3:.2f}%{{opacity:0}}{a:.2f}%,{b - 3:.2f}%{{opacity:1}}'
                   f'{b:.2f}%,100%{{opacity:0}}' if k < n_ - 1 else
                   f'0%,{a - 3:.2f}%{{opacity:0}}{a:.2f}%,100%{{opacity:1}}')
    kf.append(f'@keyframes p{k}{{{frames_}}}.p{k}{{animation:p{k} {PCYCLE}s linear infinite}}')
    groups.append(f'<g class="st p{k}{" rm" if k == 0 else ""}">\n{picker_scene(name, k)}\n</g>')
# Drawn last scene first: it sits under the first while the first fades back in, so the loop never shows a gap.
style = '\n'.join(kf) + '\n.st{opacity:0}\n@media (prefers-reduced-motion: reduce){.st{animation:none!important;opacity:0}.rm{opacity:1}}'
(OUT / 'persona-picker.svg').write_text(wrap_svg(
    W, H, 'Animation: picking a persona with /persona: Dracula, Nord, then Gruvbox, the whole window recolouring',
    '\n'.join([groups[-1]] + groups[:-1]), style))


# ---------- 4. the hero: Claude at work beside the operator pane ----------
use('catppuccin')
HH = 470
hero = [frame('claude-mods — Claude Code', h=HH, has_caption=False)]
hero.append(chat_rows(work_chat('catppuccin')))
hero.append(text(CHAT_X + 4, PROMPT_Y - 94, '{accent|u:board (1 need reply)}  {fg|u:recall}  {fg|u:PRs (2, 1 red)}  {err:●}  {accent|u:● 1 alert}'))
hero.append(text(CHAT_X + 4, PROMPT_Y - 74, '{accent|bu:▾ crew 1 running}'))
hero.append(text(CHAT_X + 4, PROMPT_Y - 54, '{accent:●} hunt flaky test{muted: · Explore · haiku · 42s}  {fg|u:view} {fg|u:msg} {fg|u:stop}'))
hero.append(text(CHAT_X + 4, PROMPT_Y - 34, '{muted:  ↳ Grep retry in src/**/*.test.ts}'))
hero.append(text(CHAT_X + 4, PROMPT_Y - 14, persona_band(LABEL[0])))
hero.append(prompt('{muted:>} ▌'))
hero.append(pane_rows([
    '{warn|b:● Alerts (1)}  {muted|u:dismiss all}',
    '{muted:14:02} CI failed: #12 Shorter PR rows   {muted|u:✓}',
    '',
    '{warn|b:▸ Board (1 need reply)}',
    '',
    '{err|b:▾ PRs (2, 1 red · 1 to review)}',
    '{accent|b:#12 Shorter PR rows} {muted:claude-mods}',
    '  {err:CI red: lint · 2d}            {accent|u:fix CI}',
    '',
    '{accent|b:▸ Git · feat/x · 2 changed}  {accent|u:push}',
    '',
    '{accent|b:▸ To-do (3 open) · autopilot on}',
    '',
    '{accent|b:▸ Usage · ctx 42% · 5h 30%}',
    '',
    '{accent|b:▸ Sessions (8)}',
]))
(OUT / 'hero.svg').write_text(wrap_svg(
    W, HH, f'Illustration: Claude Code at work with the operator pane docked beside it (persona: {LABEL[0]})', '\n'.join(hero)))


# ---------- 5. before and after ----------
BW, BH = 980, 430
WIN_W, WIN_H, WIN_Y = 470, 380, 40


def window(x, title, body_rows, pane=None, band_rows=(), tag=''):
    """A small terminal window: chat on the left, an optional pane on the right."""
    out = [f'<rect x="{x}" y="{WIN_Y}" width="{WIN_W}" height="{WIN_H}" rx="12" fill="{T["bg"]}" stroke="{T["border"]}"/>',
           ''.join(f'<circle cx="{x + 18 + i*15}" cy="{WIN_Y + 16}" r="5" fill="{c}"/>' for i, c in enumerate(['#f7768e', '#e0af68', '#9ece6a'])),
           text(x + 70, WIN_Y + 21, '{muted:' + title + '}'),
           f'<text x="{x + WIN_W - 12}" y="{WIN_Y + 21}" fill="{T["muted"]}" font-size="11" text-anchor="end">{escape(tag)}</text>',
           f'<line x1="{x}" y1="{WIN_Y + 32}" x2="{x + WIN_W}" y2="{WIN_Y + 32}" stroke="{T["border"]}"/>']
    chat_w = WIN_W - 24 if pane is None else 262
    out.append(lines(x + 12, WIN_Y + 54, body_rows))
    by = WIN_Y + WIN_H - 92
    for i, r in enumerate(band_rows):
        out.append(text(x + 12, by + i * LH, r))
    out.append(f'<rect x="{x + 8}" y="{WIN_Y + WIN_H - 48}" width="{chat_w}" height="30" rx="6" fill="none" stroke="{T["border"]}"/>')
    out.append(text(x + 18, WIN_Y + WIN_H - 28, '{muted:>} ▌'))
    if pane:
        px = x + 280
        out.append(f'<rect x="{px}" y="{WIN_Y + 42}" width="{WIN_W - 290}" height="{WIN_H - 52}" rx="8" fill="{T["panel"]}" stroke="{T["border"]}"/>')
        out.append(text(px + 10, WIN_Y + 60, '{muted|b:operator}'))
        out.append(lines(px + 10, WIN_Y + 86, pane))
    return '\n'.join(out)


ba = []
# Without: Claude Code's own drawing in a plain dark terminal.
T.clear()
T.update(bg='#161616', fg='#d4d4d4', muted='#8a8a8a', accent='#d4d4d4', ok='#5fb36b', warn='#d7a64a', err='#e5534b',
         read='#d4d4d4', write='#d4d4d4', run='#d4d4d4', search='#d4d4d4', mcp='#d4d4d4', panel='#1c1c1c', border='#3a3a3a')
ba.append(f'<rect width="{BW}" height="{BH}" rx="14" fill="#101014"/>')
ba.append('<text x="15" y="28" fill="#c8c8d0" font-weight="700" font-size="14">Without the mods</text>')
ba.append(window(15, 'Claude Code', [
    '{muted:> make the PR rows shorter}', '',
    '⏺ Read(operator-board/hooks/prs.tsx)',
    '⏺ Update(operator-board/hooks/prs.tsx)',
    '  {muted:⎿  Updated with 12 additions and 18}',
    '{muted:     removals}',
    '⏺ Bash(claude plugin test .)',
    '  {muted:⎿  39 pass}', '',
    '⏺ Each PR now takes two lines.',
], tag='terminal theme'))
# With: persona colours, its icons, the bands, and the pane.
use('dracula')
ic = icons_of('dracula')
ba.append('<text x="495" y="28" fill="#c8c8d0" font-weight="700" font-size="14">With operator-board + persona</text>')
ba.append(window(495, 'Claude Code', [
    '{muted:> make the PR rows shorter}', '',
    '{read:' + ic['read'] + '} {fg:Read} {muted:prs.tsx}',
    '{write:' + ic['write'] + '} {fg:Edit} {muted:prs.tsx} {ok:+12} {err:−18}',
    '{run:' + ic['run'] + '} {fg:Bash} {muted:plugin test} {ok:39 pass}', '',
    '{accent|b:## Shorter PR rows}',
    'Each PR now takes {fg|b:two lines}.',
], pane=[
    '{warn|b:● Alerts (1)}',
    '',
    '{warn|b:▸ Board (1 reply)}',
    '',
    '{err|b:▸ PRs (2, 1 red)}',
    '',
    '{accent|b:▸ Git · feat/x}',
    '  {accent|u:push}',
    '',
    '{accent|b:▸ To-do (3 open)}',
    '',
    '{accent|b:▸ Usage · 42%}',
], band_rows=['{accent|u:board (1)}  {fg|u:PRs (2)}  {accent|bu:crew 1}', '{accent|b:◆ Dracula} {read:●}{write:●}{run:●}{search:●}{accent:●}{ok:●}{err:●}'],
    tag='persona: Dracula'))
(OUT / 'before-after.svg').write_text(wrap_svg(
    BW, BH, 'Illustration: the same Claude Code session without the mods, and with operator-board and persona (Dracula)', '\n'.join(ba)))
print('ok')
