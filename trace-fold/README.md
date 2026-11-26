# trace-fold

A stack trace in a command's output is mostly frames from libraries and the runtime. trace-fold folds each run of them to one line in the transcript, so your own frames stand out:

```
TypeError: Cannot read properties of undefined (reading 'id')
    at getUser (/work/app/src/users.ts:14:22)
    … 6 library frames (express)
    at handler (/work/app/src/server.ts:30:5)
6 library frames folded  show all ▾
```

**show all** unfolds the whole trace. Only the drawing changes: Claude still reads every frame.

## Install

```sh
claude plugin marketplace add kg-ng/claude-mods
claude plugin install trace-fold@claude-mods
```

Restart Claude Code.

## What counts as a library frame

| Language | Folded |
|---|---|
| JavaScript, TypeScript | `node_modules`, `node:internal`, `<anonymous>`, native frames |
| Python | `site-packages`, `.venv`, the standard library, `<frozen …>` |
| Java, Kotlin, Scala | `java.`, `jdk.`, `sun.`, `kotlin.`, `org.junit.`, `org.springframework.`, `org.apache.` and the like |
| Go | the Go runtime and standard library, modules under `pkg/mod` |

A run shorter than the setting below is left as it is.

## Settings

| Setting | Default | What it does |
|---|---|---|
| Fold runs of at least | `3` | Library frames in a row it takes to fold them to one line |
