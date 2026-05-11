# Fork

`/fork-session` starts a boomerang-style fork of the current orchestrator
session. The fork receives the best compact context the parent can provide, does
the requested work, then returns a compact completion summary to the original
session.

## Usage

```text
/fork-session <what the forked orchestrator should do>
```

The command asks the current orchestrator to call `fork_session` with a compact
worker prompt and clearly relevant files.

## Flow

1. The main session calls `fork_session`.
2. Slim creates a real child session with `parentID` set to the main session.
3. The child runs as `orchestrator`, so it can use the normal specialist-agent
   workflow and delegate through `task` when useful.
4. The parent passes current context, decisions, constraints, and file
   references into the fork prompt.
5. Referenced files are loaded into the child as synthetic Read-tool context.
6. When the child finishes, Slim extracts its assistant output and returns it to
   the main session inside `<fork_summary>`.
7. The child session is aborted for cleanup after the summary is extracted.

In tmux or zellij, the fork appears like other delegated work because it is a
real child session. Existing session-depth and pane cleanup handling apply.

## Prompt style

The user prompt controls scope. Keep it direct:

```text
/fork-session finish the docs and run the relevant checks
/fork-session investigate the flaky auth test and report what changed
/fork-session implement the small UI polish we discussed
```

The fork prompt should stay compact: pass what the fork needs to act without
re-discovering the thread, then let the fork do the requested work and summarize
what happened.

## Tools

| Tool | Purpose |
|------|---------|
| `fork_session` | Creates the child worker session and returns its summary |
| `read_session` | Lets a fork worker read details from its source session |

## Safety

- Nested forks are blocked: a fork worker should finish its current task and
  return a summary instead of spawning another fork worker.
- File context is restricted to the workspace real path, including symlink
  checks.
- Binary files are skipped.
- Large files are capped before being injected as context.
- Child sessions use normal OpenCode session lifecycle events, so multiplexer
  cleanup remains consistent with other delegated agents.
