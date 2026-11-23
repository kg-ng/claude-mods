# Changelog

What changed in each version of each mod, newest first. Each version has a GitHub release, tagged `<mod>-v<version>`. To get the latest:

```sh
claude plugin marketplace update claude-mods
claude plugin update operator-board@claude-mods
claude plugin update persona@claude-mods        # then restart Claude Code
```

## operator-board

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
