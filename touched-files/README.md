# touched-files

`/touched` shows which files Claude read and edited this session, and about how many tokens of context each took, hottest first:

```
touched-files: 3 files, ~13k tokens of file content this session
  ██████████   11k  src/server.ts  read 1 · edit 1
  ██░░░░░░░░  2.0k  src/util.ts    read 1
  █░░░░░░░░░   100  README.md      read 1
Read but never edited: 2 files, ~2.1k tokens.
```

It helps you see where a session's context went, and which big files to point Claude past next time.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install touched-files@claude-mods
```

Restart Claude Code.

It counts Claude's `Read`, `Edit`, `Write` and `NotebookEdit` calls, and simple shell reads (`cat`, `head`, `tail`, `sed -n`). Tokens are estimated at four characters each, close enough to compare files, not to bill by.

## Commands

| Command | What it does |
|---|---|
| `/touched` | The 15 hottest files |
| `/touched all` | Every file |
| `/touched clear` | Starts counting again |
