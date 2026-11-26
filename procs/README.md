# procs

Dev servers, watchers and other background commands keep running after Claude moves on, and so does the "port 3000 already in use" that comes with them. procs puts a band above the prompt for what's still running in your project:

```
Running · 1 background · 2 ports  hide
bg npm run dev                     4m  stop
:3000 node  pid 501                    kill
:5173 vite  pid 902                    kill
```

- **bg** rows are commands Claude started in the background. **stop** stops one, the same as Claude's own TaskStop.
- **:port** rows are processes listening on a TCP port whose working folder is in this project, found with `lsof`. **kill** sends one SIGTERM.

When a command fails with "address already in use", Claude is told which process holds the port. It reuses the server or stops its own task, and asks you before killing anything else.

The band hides when nothing is running. It refreshes every 20 seconds and when a turn ends.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install procs@claude-mods
```

Restart Claude Code.

Needs `lsof` for ports (macOS and most Linux). Without it, the band shows background commands only.

## Commands

| Command | What it does |
|---|---|
| `/procs` | Lists what's running |
| `/procs hide`, `/procs show` | Hides the band, or shows it again |
