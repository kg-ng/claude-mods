"""Draws the README's animated illustrations: looping SVGs, four steps each.

The strings drawn come from operator-board's render code (labels, alert texts, headers);
the sample data is made up. CSS keyframes only (no script), so GitHub plays them in <img>.
With reduced motion on, each shows its third step, still.
"""
import re
import sys
from html import escape
from pathlib import Path

OUT = Path(sys.argv[1])
T = dict(bg='#1a1b26', panel='#16161e', chat='#1a1b26', border='#3b4261', fg='#c0caf5', muted='#737aa2',
         accent='#7aa2f7', ok='#9ece6a', warn='#e0af68', err='#f7768e', read='#7dcfff', write='#ff9e64',
         mcp='#73daca', banner='#2a2e42')
FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace"
FS = 13
CW = FS * 0.6
LH = 19
CYCLE = 16  # seconds for the four steps

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


def frame(title):
    return '\n'.join([
        f'<rect width="{W}" height="{H}" rx="14" fill="{T["bg"]}"/>',
        f'<rect x="0.5" y="0.5" width="{W-1}" height="{H-1}" rx="14" fill="none" stroke="{T["border"]}"/>',
        ''.join(f'<circle cx="{22 + i*18}" cy="20" r="6" fill="{c}"/>' for i, c in enumerate(['#f7768e', '#e0af68', '#9ece6a'])),
        text(W / 2 - len(title) * CW / 2, 25, '{muted:' + title + '}'),
        f'<line x1="0" y1="38" x2="{W}" y2="38" stroke="{T["border"]}"/>',
        # the pane
        f'<rect x="{PANE_X}" y="{TOP}" width="{PANE_W}" height="{CAP_Y - TOP - 18}" rx="8" fill="{T["panel"]}" stroke="{T["border"]}"/>',
        text(PANE_X + 14, TOP + 20, '{muted|b:operator}'),
        f'<line x1="{PANE_X}" y1="{TOP + 30}" x2="{PANE_X + PANE_W}" y2="{TOP + 30}" stroke="{T["border"]}"/>',
        # the prompt
        f'<rect x="{CHAT_X}" y="{PROMPT_Y}" width="{CHAT_W}" height="34" rx="6" fill="none" stroke="{T["border"]}"/>',
        # caption strip
        f'<line x1="0" y1="{CAP_Y}" x2="{W}" y2="{CAP_Y}" stroke="{T["border"]}"/>',
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
print('ok')
