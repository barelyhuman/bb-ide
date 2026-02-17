# Thread-Scoped Env Context + CLI Env Fallback Plan

## Goal

Make thread context available as environment variables inside Codex-executed shell commands, and let `bb` commands use that context without repeatedly passing flags.

Target vars:

- `BB_PROJECT_ID`
- `BB_TASK_ID` (when a thread is task-linked)
- `BB_THREAD_ID`

## Constraints (from Codex app-server)

- `command/exec` has no per-command `env` parameter.
- Command/tool env is derived from `shell_environment_policy`.
- Thread config overrides (`thread/start`, `thread/resume`, `thread/fork`) can set config via dotted-path keys.
- `shell_environment_policy.set` supports explicit env injection.

Implication: we must inject env at thread config level, not at each `command/exec` call.

## Current State in Beanbag

- Daemon process spawn already injects:
  - `BEANBAG_THREAD_ID`
  - `BEANBAG_TASK_ID` (optional)
  - file: `apps/daemon/src/thread-manager.ts`
- CLI today:
  - `thread spawn` requires `--project`.
  - `task create|list|ready` require `--project`.
  - `thread spawn` falls back to `BEANBAG_TASK_ID` and `BEANBAG_THREAD_ID` for task/parent context.
  - files: `apps/cli/src/commands/thread.ts`, `apps/cli/src/commands/task.ts`

This plan replaces that behavior with `BB_*` only (no legacy alias support).

## Design

### 1. Thread config env injection (Codex-facing)

Implement thread-scoped env injection in provider params so Codex uses the vars for tool/turn shell executions.

- Add helper in `apps/daemon/src/codex-provider-adapter.ts` to merge config safely.
- Add dotted-path config keys when building start/resume params:
  - `shell_environment_policy.set.BB_PROJECT_ID`
  - `shell_environment_policy.set.BB_THREAD_ID`
  - `shell_environment_policy.set.BB_TASK_ID` (only when task exists)
- Preserve existing config values (for example `model_reasoning_effort`) when adding these keys.

### 2. Pass thread context into adapter methods

Current adapter signatures do not receive enough metadata everywhere.

- Update provider adapter contract in `apps/daemon/src/provider-adapter.ts` so `createThreadStartParams` and `createThreadResumeParams` can receive thread context (`projectId`, `threadId`, optional `taskId`).
- Update call sites in `apps/daemon/src/thread-manager.ts`:
  - provisioning path (`thread/start`)
  - resume path (`thread/resume`)
  - boot-time restoration path

Note: daemon does not currently call `thread/fork`; when/if added, apply the same context injection there.

### 3. Standardize process env to `BB_*`

In `apps/daemon/src/thread-manager.ts` process spawn env, set:

- `BB_PROJECT_ID`, `BB_TASK_ID`, `BB_THREAD_ID`

### 4. Ensure `bb` is runnable in agent shells

Ensure agent shell commands can execute `bb` directly.

- If `bb` already exists on daemon PATH, prepend its bin directory to PATH for threads.
- If `bb` is missing, create a daemon-managed `bb` shim script in a stable temp bin directory that launches the local CLI entrypoint.
- Inject `shell_environment_policy.set.PATH` with that bin directory prepended so Codex tool/turn shells can resolve `bb`.
- Mirror the same PATH prefix in provider process env (`thread-manager` spawn env) so runtime behavior is consistent.
- Do not introduce a new user-facing env var for CLI path override (`BB_CLI_BIN` is not required).

### 5. CLI env fallback behavior

Introduce a shared resolver module (for example `apps/cli/src/context-env.ts`) and use it from task/thread commands.

Resolution precedence:

1. Explicit CLI flag value
2. `BB_*` env var

Command updates:

- `thread spawn --project` becomes optional at Commander level and required at runtime via resolver.
- `task create|list|ready --project` same pattern.
- `thread list --project` uses env as default filter when flag omitted.
- `thread spawn --task` and `--parent-thread` use resolver fallback (`BB_TASK_ID`, `BB_THREAD_ID`).

Validation behavior:

- If required context is missing after fallback, show explicit error naming accepted `BB_*` vars.

### 6. Docs and agent guidance

Update docs and instruction strings where we currently teach explicit flags only.

Candidate files:

- `apps/daemon/src/agent-roles.ts`
- `apps/daemon/src/routes/tasks.ts`
- `README.md` (or add a focused CLI doc)

Include examples such as:

- `BB_PROJECT_ID=proj_123 bb task list`
- `BB_PROJECT_ID=proj_123 BB_TASK_ID=task_1 BB_THREAD_ID=thr_1 bb thread spawn --prompt "..."`

## Test Plan

### Daemon tests

- `apps/daemon/src/__tests__/codex-provider-adapter.test.ts`
  - start/resume params include `shell_environment_policy.set.BB_*` keys
  - reasoning config and env config coexist without overwrite
  - `shell_environment_policy.set.PATH` is prefixed with resolved `bb` bin dir
- `apps/daemon/src/__tests__/thread-manager.test.ts`
  - outbound `thread/start` payload includes injected env config
  - resume payload includes injected env config
  - child process spawn env includes only `BB_*` thread/task/project vars
  - child process spawn env PATH includes `bb` bin prefix

### CLI tests

Add `apps/cli/src/__tests__/context-env.test.ts`:

- flag overrides env
- `BB_*` used when flag absent
- clear error when required project context missing

## Rollout

### Phase 1

- Implement daemon + CLI support for `BB_*` only.
- Remove existing `BEANBAG_*` CLI fallback behavior.
- Implement PATH injection so agents can run `bb` without extra setup.
- Update docs/examples to use `BB_*`.

## Acceptance Criteria

- In a thread with context set, commands like `bb task list` and `bb task create --title ...` work without `--project`.
- `bb thread spawn --prompt "..."` can inherit task/parent context from env.
- Thread start/resume payloads sent to Codex include `shell_environment_policy.set` entries for `BB_*`.
- Agent shell sessions resolve `bb` on PATH reliably.
- Existing tests pass, and new env-resolution tests pass.
