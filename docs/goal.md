# Goal

`/goal` is a durable-objective mode for long-running work in
oh-my-opencode-slim.

It is meant for tasks where the orchestrator should keep working through a clear
objective, maintain progress, validate the result, and stop when the goal is
done without needing the user to steer every step.

The first implementation focuses on one active goal per session, persisted goal
state, prompt context, and guarded idle continuation.

## When to use it

Use `/goal` for work with a clear finish line:

- implement a feature from a spec,
- fix a bug and prove it with tests,
- migrate code from one API or pattern to another,
- refactor a subsystem while keeping checks green,
- update docs to match changed behavior,
- investigate an issue, patch it, and validate the fix.

Avoid it for vague or high-risk work:

- "improve the codebase",
- open-ended product/design exploration,
- destructive operations,
- production deploys or credential handling,
- tasks that need frequent human approval.

## Command shape

The command set is:

```text
/goal start <objective>
/goal
/goal status
/goal pause
/goal resume
/goal complete [note]
/goal block <reason>
/goal clear
/goal checkpoint <note>
```

Planned follow-up commands may include:

```text
/goal validate <command>
/goal stop-condition <text>
/goal list
/goal export
```

Examples:

```text
/goal start Fix the tmux ghost pane issue. Stop when tests pass and no orphaned opencode attach processes remain.
```

```text
/goal start Implement the preset-switching docs update. Stop when README.md and docs/configuration.md agree with the current command behavior.
```

## How it should work

1. The user starts a goal with an objective and, ideally, a stopping condition.
2. Slim persists the active goal for the current project/session.
3. The orchestrator receives compact goal context in its system prompt.
4. The orchestrator creates and maintains todos for the goal.
5. Normal delegation still applies: Explorer scouts, Librarian researches,
   Oracle reviews, Designer handles UI, and Fixer executes scoped changes.
6. When the session goes idle and the goal is still running, Slim can safely
   continue the orchestrator after a cooldown.
7. The orchestrator validates through normal tools and marks the goal completed,
   blocked, or paused.

The feature should make long work feel supervised, not uncontrolled. Progress
should be visible through status/checkpoints, and the user should always be able
to pause or clear the goal.

## Relationship to todo continuation

`/auto-continue` is todo-based: it resumes the orchestrator when incomplete
todos remain.

`/goal` should be objective-based: it owns the durable user objective, lifecycle,
checkpoints, stop condition, and validation expectations.

The two features do not run competing continuation loops. When an active goal
owns a session, todo continuation skips that session, including paused and
blocked goals.

## State model

The implementation keeps one active goal per session and persists a compact
record outside the repository by default.

Suggested shape:

```ts
type GoalStatus =
  | 'running'
  | 'paused'
  | 'blocked'
  | 'completed'
  | 'archived';

interface GoalRecord {
  version: 1;
  id: string;
  directory: string;
  sessionID?: string;

  objective: string;
  stopCondition?: string;
  validationCommands: string[];
  artifacts: string[];

  status: GoalStatus;

  createdAt: string;
  updatedAt: string;

  maxCycles: number;
  completedCycles: number;

  checkpoints: GoalCheckpoint[];
  lastError?: string;
}
```

State should live in an XDG-style user data location rather than creating noisy
files in every workspace. A later export command can write a Markdown summary
when users want a shareable artifact.

## Validation

Slim should not secretly execute validation commands.

Instead:

- store validation commands on the goal,
- inject them into the orchestrator's goal context,
- let the orchestrator run them through normal OpenCode tool permissions,
- optionally record observed results later.

This preserves the normal permission model and keeps command execution visible.

## Implementation

The feature lives in:

```text
src/goal/
  index.ts
  manager.ts
  store.ts
  types.ts
  prompts.ts
  command.ts
```

It is wired through `src/index.ts`:

- initialize the goal manager,
- register `/goal`,
- handle command execution,
- inject compact goal context into orchestrator messages,
- observe session lifecycle events,
- coordinate with todo continuation to avoid double resumes.

Current scope:

- `/goal start/status/pause/resume/checkpoint/clear`,
- `/goal complete` and `/goal block <reason>`,
- durable JSON state,
- one active goal per session,
- compact prompt injection,
- safe idle continuation with max-cycle limits,
- manual status/checkpoint output,
- docs and tests.

Defer:

- TUI/sidebar integration,
- automatic validation execution,
- multi-goal dependency graphs,
- git checkpoints,
- artifact registry,
- automatic checkpoint summarization.

## Safety gates

Goal continuation should use strict guards similar to todo continuation:

- current session is orchestrator-owned,
- active goal status is `running`,
- goal has not exceeded max cycles,
- no pending continuation is already in flight,
- session is not in a post-abort suppress window,
- latest assistant message is not asking the user a question,
- no conflicting `/auto-continue` loop owns the session.

If the orchestrator is uncertain, blocked, or needs approval, it should mark the
goal blocked or ask the user instead of continuing indefinitely.

## Future version

A fuller version can add a structured tool such as `goal_update` so the
orchestrator can update status, checkpoints, validation results, and artifacts
without relying on prose parsing.

Possible later additions:

- `/goal list` for cross-session resume,
- automatic checkpoint cadence,
- validation result capture from tool events,
- TUI goal status,
- Markdown export,
- stale-session recovery,
- optional review routing through Oracle before completion.
