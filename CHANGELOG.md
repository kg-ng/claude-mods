# Changelog

What changed in each version of each mod, newest first. Each version has a GitHub release, tagged `<mod>-v<version>`. To get the latest:

```sh
claude plugin marketplace update claude-mods
claude plugin update operator-board@claude-mods
claude plugin update persona@claude-mods        # then restart Claude Code
```

## operator-board

### 0.18.2

- **Board updates sent together all land.** When Claude sent several `board_update` calls at once, only the last was kept; now they run one after another, each with its own id.

### 0.18.1

- **Alert sound** setting (on by default): turn it off when [chimes](chimes) plays your sounds, so you don't hear both.

### 0.18.0

- **Crew** in the band: while subagents run, the band above the prompt lists them, one row each: what it's on now (its last tool call), type, model, time and tokens. **view** opens its transcript, **msg** sends it a message, **stop** stops it (or, when stopping needs your OK, puts the request in the prompt). Finished agents stay a minute, then drop off; the crew header folds it to one line. Works in the terminal.
- README pictures: the crew in the band, hero and before-and-after pictures; the overview says 0.18.0; the animations play 50% faster (a 10.7s loop for the alert and dev flows, 8s for the persona picker).

### 0.17.0

- **Model** in Usage: the model Claude is answering with (as `/model` shows it) and the main thread's tokens on it this session: input (cached and not), output, and how much the prompt cache served. Other models the main thread used this session are listed under it. A **/model** button puts `/model ` in the prompt box.
- README pictures for Usage and Quick prompts show the advisor, model and /btw rows.

### 0.16.0

- **/btw** in Quick prompts: puts `/btw ` in the prompt box, for a side question answered without interrupting Claude.
- **Advisor** in Usage: how many times Claude consulted the advisor this session, when it last did and how long it took, and a **/advisor** button to pick its model or turn it off.

### 0.15.0

- **Hotkeys:** while the pane has the keyboard (click it, or ctrl+x tab), `1`–`8` open or fold Board, To-do, Usage, Git, Sessions, Quick prompts, PRs and Recall. Each header shows its digit then.
- **Run buttons in Git:** **test**, **lint**, **typecheck** and **build** from your `package.json` scripts (with your package manager: npm, pnpm, yarn or bun), else from Makefile targets. Each one fills the prompt.
- **CI on your branch before a PR exists:** once a branch is pushed, Git shows its GitHub checks (`CI 3/5`, `CI green`, `CI red: lint`), and the folded header names a red or running one.
- **Scrollbar** keeps its size right when the pane grows by itself (new board items, a PR refresh), not only when you scroll.

### 0.14.0 · [#10](https://github.com/kg-ng/claude-mods/pull/10)

- **To review:** PRs that ask for your review, each with a **review** button. The PRs header counts them: `PRs (2, 1 red · 3 to review)`.
- **CI passed:** an alert when CI turns green on your PR.
- **merge** button on ready PRs.
- **Claude changed N files +a −b** in Git: the files Claude edited this session, with **review** and **commit**, until they're committed.
- The Git header offers the branch's next step: **push** or **open PR**.

### 0.13.2 · [#9](https://github.com/kg-ng/claude-mods/pull/9)

- `register.tsx` split into one module per section (board, prs, sessions, recall). No visible change.

### 0.13.1 · [#7](https://github.com/kg-ng/claude-mods/pull/7)

- No "pane not opened" line in the chat on a narrow terminal.
- All type-check warnings fixed, and an icon added.

### 0.13.0 · [#6](https://github.com/kg-ng/claude-mods/pull/6)

- **▸ show operator pane** above the prompt while the pane waits hidden on a narrow terminal. One click opens it.

### 0.12.0 · [#5](https://github.com/kg-ng/claude-mods/pull/5)

- The pane's width follows your terminal instead of a fixed 48 columns. A width you drag it to is kept.

### 0.11.1 · [#4](https://github.com/kg-ng/claude-mods/pull/4)

- `/operator` now shows a pane held back on a narrow terminal, instead of closing it (it used to take two tries).

### 0.11.0 · [#2](https://github.com/kg-ng/claude-mods/pull/2)

- A scrollbar in the pane once it's taller than its window.

### 0.10.0 · [#1](https://github.com/kg-ng/claude-mods/pull/1)

- PR rows down from about five lines to two: the title, then what's wrong, CI and age, with the fix button on the same line.
- Sections that need you (a reply waiting, red CI, usage at your limits) move to the top of the pane.

### 0.9.0

- Alerts you can find again: a system notification titled `Claude · <folder>`, the ● Alerts strip in the pane, and the count on the band. Reply alerts clear themselves once answered.
- A new alert when a turn ends needing your reply.

### 0.8.0

- Folded section headers show a one-line summary.
- Buttons that fill the prompt: **fix CI**, **address threads** / **address review**, Git **review** and **commit**.
- Needs reply and Pending come before Recent asks.

### 0.7.0

- First release in this repo: the board, to-do list with autopilot, usage, git, sessions, quick prompts, PRs and recall in one pane.

## persona

### 0.7.1 · [#7](https://github.com/kg-ng/claude-mods/pull/7)

- An icon, and a type-check fix in the tests.

### 0.7.0 · [#3](https://github.com/kg-ng/claude-mods/pull/3)

- Code blocks copy clean: rules above and below instead of a box, so selecting the lines copies only the code, plus a **copy** button.

### 0.6.1

- First release in this repo: 24 built-in personas for replies, tool icons, spinner words, the band and the terminal's own colours.

## guard

### 0.2.0

- **Wrapped commands are checked too:** `bash -c "…"`, `sh -c`, `eval`, subshells `( … )` and `$( … )`, `{ …; }`, `sudo -u <user>`, `env -i`, `xargs`, and full paths like `/bin/rm` or `/usr/bin/git`. Before, each of these let a stopped command through.

### 0.1.0

- **First version.** Before Claude runs a shell command, guard checks it: pushes and force-pushes onto protected branches (`main`, `master`, or your list), deleting them, `push --mirror`/`--all`, and `rm -rf` on `/`, `~`, a variable, `..` or a path outside the project are stopped, with a reason Claude can act on. Each part of a chained command is checked; quoted text and heredocs aren't.
- **Co-author lines** (`Co-Authored-By: Claude`, "Generated with Claude Code") come out of commit messages and PR bodies.
- `/guard`, `/guard on`, `/guard off`.

## diff-cards

### 0.1.0

- **First version.** Each Edit, Write and MultiEdit diff in the transcript folds to one line (`+12 −18 · 2 hunks`, or `new file · +40`) with **show diff** / **hide diff** to unfold Claude Code's own diff in place. Diffs of 6 changed lines or fewer (a setting), the ctrl+o transcript, failed edits and edits held for review are drawn as before.

## turn-meter

### 0.1.0

- **First version.** Each main-thread turn's closing line (`Baked for 42s`) gets ` · 180k in · 3.1k out · $0.41`: input tokens (cached included), output tokens, and how much the session's cost rose during the turn. Turns at or over $0.50 (a setting) are drawn in amber. The ctrl+o transcript keeps the plain line.

## chimes

### 0.1.0

- **First version.** Soft sounds (made by `tools/make_sounds.py`): **finished** after a main-thread turn of 20 seconds or more, **needs you** on Claude Code's own notification (a permission prompt, waiting for input), and **passed**, **failed** or **needs you** for any mod's desktop notification, picked from its words. Sounds within 0.4 seconds play once, the most urgent. Quiet within 5 seconds of typing in the prompt. `/chimes`, `/chimes test`, `/chimes on|off`. macOS.

## focus

### 0.1.0

- **First version.** `/focus-timer [25|90m|1h|stop]` runs a timer in the status line (`◉ focus · 18m left · 2 held`). While it runs, every other mod's desktop notification is held, and their sounds too (a setting). At the break, one notification lists what came in. Claude Code's own permission prompts are never held. (Claude Code ships `/focus`, hence `/focus-timer`.)

## copilot/operator-board

### 0.1.0

- **First version for GitHub Copilot CLI**, as a Copilot extension: the `board_update`, `todo_update` and `checkpoint_save` tools, `/board`, `/todo` and `/savepoint`, and the folder's open to-dos, needs-reply items and latest checkpoint at session start.
- **Shares `~/.claude/operator-board/`** with the Claude Code mod, so both tools see the same to-dos, board and checkpoints. Copilot's items carry `"source": "copilot"`.
- **Status line script** for Copilot's `statusLine.command`: context %, AI credits, to-dos and needs-reply.
- Installed with `install.sh`; needs Copilot's experimental features on. No pane: Copilot extensions don't have one.
