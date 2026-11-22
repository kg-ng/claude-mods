# claude-mods

Two mods for [Claude Code](https://claude.com/claude-code), published as a plugin marketplace:

| Mod | Version | What it does |
|---|---|---|
| [`operator-board`](operator-board) | 0.13.0 | One side pane for running a session: a board of what's waiting on you, a to-do list with autopilot, usage, git, earlier sessions, quick prompts, your PRs and recall. Alerts you can find again. |
| [`persona`](persona) | 0.7.0 | Themes for the terminal, Claude's replies and the panels: colours, tool icons, spinner words and an animated scene while Claude works. 24 built-ins, or make your own. |

![How the repo, the two mods and Claude Code fit together](docs/images/overview.svg)

> The pictures in this README are drawn from the mods' render code with sample data. They are illustrations, not screenshots.

## Requirements

- Claude Code with plugin hooks modules (built and tested on 2.1.323).
- `git` for the Git section, and the [GitHub CLI](https://cli.github.com) (`gh auth login`) for the PRs section. Everything else works without them.
- The operator pane docks on the right in Claude Code's fullscreen layout from 110 columns. Below that it sits above the prompt instead.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install operator-board@claude-mods
claude plugin install persona@claude-mods
```

You can install either mod on its own. **Restart Claude Code** afterwards to load them.

To check they loaded, type `/operator` (the pane opens) and `/persona` (the picker opens).

## operator-board

### The pane

`/operator` opens or closes the pane. The pane's width follows your terminal: Claude Code gives it a share of the window (at most 45%) and resizes it with the window. Drag its edge to pick your own width, and Claude Code keeps it. The pane also opens by itself when a session starts, but Claude Code only shows a pane opened that way on a terminal at least 144 columns wide (110 once you've opened it yourself). On a narrower terminal, a **▸ show operator pane** button appears above the prompt: click it, or type `/operator`. If you leave the pane open, later sessions show it on their own from 110 columns. Every section starts folded, and its header carries a one-line summary, so you can see what needs you without opening anything. Click a header to open it.

<img src="docs/images/operator-pane.svg" width="480" alt="Illustration: the operator pane with every section folded, each header showing a one-line summary">

Header colours: **amber** when something waits on you (a reply, a usage warning) and **red** when something is broken (failing CI, usage past your stop line). Sections that need you move to the top of the pane, and go back to their place once they're handled.

When the pane is taller than its window, a scrollbar on the right shows where you are. Scroll with the mouse wheel, or click the pane and use the arrow and page keys.

| Section | What it shows |
|---|---|
| **Board** | *Needs reply*: questions Claude asked you, each with a button that fills your answer into the prompt. *Pending*: open work grouped by section (CI, follow-ups, your action). *Recent asks* from this and other sessions. Switch between "this folder" and "all sessions". |
| **To-do** | A to-do list for the folder, shared by every session in it. Claude proposes items, you approve them. Turn on **autopilot** and Claude starts the next item when it finishes one. It stops at a cap, or when usage reaches your warn line. |
| **Usage** | Context used, 5-hour and weekly limits, and session cost. |
| **Git** | Branch, changed files, ahead and behind, and buttons that fill in `/code-review` or a commit request. |
| **Sessions** | Earlier sessions with **resume**, **continue** and **copy cmd**, plus checkpoints saved with `/savepoint`. |
| **Quick prompts** | Prompts you pin with `/quick` and send with one click. |
| **PRs** | Your open PRs, two lines each: the title, then what's wrong, CI and age (`CI red: lint, e2e · 2d`). A PR that needs work gets a button on that line that fills the prompt: **fix CI**, **address threads** or **address review**. Nothing is sent until you press Enter. PRs that are ready collapse to one line each. |
| **Recall** | Search earlier questions and answers. |

<img src="docs/images/board-and-prs.svg" width="480" alt="Illustration: Board and PRs sections open, with one-click reply and fix CI buttons">

### Alerts

When a turn ends with a question for you, a PR's CI fails, or usage crosses your limits, operator-board:

1. chimes and sends a system notification titled `Claude · <folder>`, so you know which session it came from;
2. adds the alert to the **● Alerts** strip at the top of the pane, where it stays until you tick it ✓ or **dismiss all**;
3. removes reply alerts by itself once you answer or mark the item done.

Whether a banner appears depends on your Claude Code notification setting (`preferredNotifChannel`) and your terminal's notification settings. `/alerts off` turns alerts off and `/alerts on` turns them back on.

### The band

A row above the prompt with shortcuts into the pane: the board (with how many need a reply), recall, PRs (with a red dot when CI fails) and the alert count.

![Illustration: the operator-board and persona bands drawn above the Claude Code prompt](docs/images/bands.svg)

### Commands

| Command | What it does |
|---|---|
| `/operator` | Open or close the pane |
| `/board` · `/prs` · `/sessions` | Open or fold that section (`/prs` also refreshes) |
| `/savepoint` | Save a checkpoint of this session, which Sessions can continue from |
| `/quick` | Pin a quick prompt |
| `/alerts [on\|off]` | Turn alerts on or off |

Claude also gets three tools, `board_update`, `todo_update` and `checkpoint_save`. Claude uses them to post questions and pending work to the board, keep the to-do list and save checkpoints. You don't call these yourself.

## persona

Type `/persona` and use ↑/↓ to preview, Enter to pick. Your choice is remembered across sessions.

![The 24 built-in personas](docs/images/personas.svg)

A persona changes Claude's replies, the tool-row icons, the spinner and footer words, the band, and the terminal's own 16 colours plus background, text and cursor. While Claude works, the band shows an animated scene such as rain, snow or stars. Make your own with `/persona new <name> <bg> [fg] [accent …]`, or ask Claude: "make me a persona that feels like a sunset."

Every command and setting is in [persona/README.md](persona/README.md).

## Update and uninstall

```sh
claude plugin marketplace update claude-mods
claude plugin update operator-board@claude-mods
claude plugin update persona@claude-mods        # then restart Claude Code
```

```sh
claude plugin uninstall operator-board@claude-mods
claude plugin uninstall persona@claude-mods
claude plugin marketplace remove claude-mods
```

## Develop

Clone the repo and add it as a local marketplace instead of the GitHub one:

```sh
git clone https://github.com/kg-ng/claude-mods.git
claude plugin marketplace add ./claude-mods
claude plugin install operator-board@claude-mods
claude plugin install persona@claude-mods
```

Test and validate before you open a PR:

```sh
cd operator-board && claude plugin test . && claude plugin validate .
cd ../persona && claude plugin test . && claude plugin validate .
```

Bump the mod's `version` in its `.claude-plugin/plugin.json` with every change, or `claude plugin update` won't pick the change up. Then run the update commands above.

The README illustrations come from `docs/images/*.svg`. If you change what the pane draws, update them to match.

## Contributing

Pull requests are welcome. `main` is protected: every change needs a pull request approved by the code owner, [@kg-ng](https://github.com/kg-ng) (see [CODEOWNERS](.github/CODEOWNERS)). Force-pushes and deleting `main` are blocked.

## License

[MIT](LICENSE)
