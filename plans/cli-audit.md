# CLI Audit Plan

**Guiding principle:** "Anything users can do in the product, agents can do with the CLI."

The CLI should be well-designed, consistent, and free of redundant or confusing commands. Every command must support `--json` for machine-readable output unless there is a documented reason to exclude it.

---

# Complete Command Table

## `bb status`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb status` | Show current context | (none) | **No** | Missing `--json`. Only prints BB_PROJECT_ID and BB_THREAD_ID from env. |

## `bb project`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb project list` | List projects | `--json` | Yes | |
| `bb project create` | Create a project | `--name <name>` (required), `--root <path>` (required), `--json` | Yes | |
| `bb project files <query>` | Search files within a project | `--project <id>`, `--limit <n>` | **No** | Missing `--json`. Outputs bare file paths, not structured data. |

## `bb provider`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb provider list` | List available providers | `--json` | Yes | |
| `bb provider models [providerId]` | List available models for a provider | `--json` | Yes | |

## `bb thread`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb thread spawn` | Spawn a new thread for a project | `--prompt <prompt>`, `--json`, `--project <id>`, `--environment <id-or-path>`, `--new-environment <kind>`, `--parent-thread <id>`, `--provider <id>`, `--model <model>`, `--reasoning-level <level>`, `--title <title>`, `--no-context-parent-thread` | Yes | Missing `--service-tier`, `--sandbox-mode`, `--developer-instructions` that the backend supports. |
| `bb thread list` | List threads | `--project <id>`, `--parent-thread <id>`, `--include-archived`, `--json` | Yes | Missing `--include-work-status` (backend supports `includeWorkStatus` query param). |
| `bb thread show [id]` | Show thread details | `--json` | Yes | Overlaps heavily with `bb thread status`. See redundancy analysis. |
| `bb thread status [id]` | Show thread status | `--json`, `--recent-events <count>`, `--event-mode <mode>`, `--include-low-signal` | Yes | Overlaps with `bb thread show`. `status` adds event inspection. |
| `bb thread output [id]` | Get the final output of a thread | `--json` | Yes | |
| `bb thread log [id]` | Show thread event log | `--json`, `--format <format>` | Yes | `--json` is an alias for `--format json`. Good design. |
| `bb thread sessions [id]` | Show env-daemon sessions for a thread | `--json` | Yes | |
| `bb thread tell <id> <message>` | Send a follow-up message to a thread | `--json`, `--model <model>`, `--reasoning-level <level>` | Yes | Missing `--service-tier`, `--sandbox-mode`, `--demote-primary-if-needed` that the backend supports. |
| `bb thread steer <id> <message>` | Steer a thread with an additional message | `--json`, `--model <model>`, `--reasoning-level <level>` | Yes | Same missing flags as `tell`. Functionally identical to `tell` but sets `mode: "steer"`. Consider merging into `tell --mode steer`. |
| `bb thread update [id]` | Update a thread | `--json`, `--title <title>`, `--parent-thread <id>`, `--clear-parent-thread` | Yes | Missing `--merge-base-branch` (backend supports it in PATCH). |
| `bb thread wait [id]` | Wait for a thread status or event | `--status <status>`, `--event <type>`, `--timeout <seconds>`, `--poll-interval <ms>` | **No** | Missing `--json`. Agent use case: poll + get structured result. |
| `bb thread commit <id>` | Request an agent-driven commit | `--message <message>`, `--staged-only` | **No** | Missing `--json`. Returns unstructured text via `printThreadOperationResult`. |
| `bb thread squash-merge <id>` | Request an agent-driven squash-merge | `--commit-if-needed`, `--staged-only`, `--commit-message <message>`, `--squash-message <message>`, `--merge-base-branch <branch>` | **No** | Missing `--json`. Same unstructured output as `commit`. |
| `bb thread stop <id>` | Stop an active thread | (none) | **No** | Missing `--json`. Only prints confirmation text. |
| `bb thread archive [id]` | Archive a thread | `--force` | **No** | Missing `--json`. Only prints confirmation text. |
| `bb thread unarchive [id]` | Unarchive a thread | (none) | **No** | Missing `--json`. Only prints confirmation text. |
| `bb thread delete [id]` | Delete a thread permanently | `--yes` | **No** | Missing `--json`. Only prints confirmation text. |
| `bb thread promote <id>` | Promote a worktree thread into primary checkout | (none) | **No** | Missing `--json`. |
| `bb thread demote [id]` | Demote currently promoted thread from primary checkout | `--project <id>` | **No** | Missing `--json`. |
| `bb thread promote-status` | Show which thread is active in primary checkout | `--project <id>` | **No** | Missing `--json`. |

## `bb manager`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb manager hire [projectId]` | Hire a new manager for a project | `--project <id>`, `--title <title>`, `--provider <id>`, `--model <model>`, `--json` | Yes | |
| `bb manager list [projectId]` | List managers for a project | `--project <id>`, `--json` | Yes | |
| `bb manager status <id>` | Show manager status and managed threads | `--json` | Yes | |
| `bb manager threads <id>` | List threads managed by a manager | `--json` | Yes | Redundant with `bb thread list --parent-thread <id>`. |
| `bb manager send <id> <message>` | Send a message to a manager thread | `--json` | Yes | Redundant with `bb thread tell <id> <message>`. Lacks `--model`, `--reasoning-level` that `tell` has. |
| `bb manager log <id>` | Show manager thread event log | `--json` | Yes | Redundant with `bb thread log <id>`. Lacks `--format` that `thread log` has. |
| `bb manager delete <id>` | Delete a manager permanently | `--yes` | **No** | Missing `--json`. Same issue as `bb thread delete`. |

## `bb daemon`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb daemon health` | Show daemon health and managed storage usage | `--json` | Yes | |
| `bb daemon restart` | Safely request daemon shutdown before restart | `--force` | **No** | Missing `--json`. |

## `bb environment-agent`

| Command | Description | Flags | Has --json? | Notes |
|---------|-------------|-------|-------------|-------|
| `bb environment-agent` | Run the environment-agent HTTP service | `--provider-command <command>`, `--provider-arg <arg>` (repeatable), `--provider-launch-command <command>`, `--provider-launch-arg <arg>` (repeatable), `--http-port <port>`, `--http-host <host>` | **No** | Long-running server process. `--json` is not applicable. Intentionally excluded. |

---

# Design Issues

## 1. Missing `--json` support (16 commands)

Commands without `--json` that should have it:

| Command | Severity | Notes |
|---------|----------|-------|
| `bb status` | P1 | Agents need to read context programmatically. |
| `bb project files` | P1 | Returns bare text lines; should support structured output. |
| `bb thread wait` | P1 | Agents use wait heavily; should return structured result on completion. |
| `bb thread commit` | P1 | Returns `ThreadOperationResponse` but only prints text. Trivial to add. |
| `bb thread squash-merge` | P1 | Same as commit. |
| `bb thread stop` | P2 | Simple confirmation, but agents still benefit from structured response. |
| `bb thread archive` | P2 | Same as stop. |
| `bb thread unarchive` | P2 | Same as stop. |
| `bb thread delete` | P2 | Same as stop. |
| `bb thread promote` | P2 | Returns structured data from API but only prints message text. |
| `bb thread demote` | P2 | Same as promote. |
| `bb thread promote-status` | P2 | Could return `{ threadId: string | null }`. |
| `bb manager delete` | P2 | Same as thread delete. |
| `bb daemon restart` | P2 | Returns structured shutdown response but only prints text. |

**Intentionally excluded:** `bb environment-agent` (long-running server process).

## 2. Redundant commands

### `bb manager threads <id>` vs `bb thread list --parent-thread <id>`

These do the exact same thing: list threads where `parentThreadId` matches the given manager ID. `manager threads` first validates the thread is a manager, but that's a minor guard.

**Recommendation:** Deprecate `bb manager threads`. Users and agents should use `bb thread list --parent-thread <id>`. The manager-type validation can be an optional concern of `thread list` if needed.

### `bb manager send <id> <message>` vs `bb thread tell <id> <message>`

`manager send` is a thin wrapper around the same `/tell` API endpoint. The only difference is `manager send` validates the target is a manager thread first. But `tell` already works on manager threads.

**Recommendation:** Deprecate `bb manager send`. It is strictly less capable than `bb thread tell` (missing `--model`, `--reasoning-level`). If manager-type validation is desired, add `--type manager` guard to `tell`.

### `bb manager log <id>` vs `bb thread log <id>`

`manager log` wraps the same events endpoint but with worse formatting (no `--format` option, uses a different `printEvent` function).

**Recommendation:** Deprecate `bb manager log`. Users should use `bb thread log <id>`.

### `bb thread show` vs `bb thread status`

Both fetch the same thread object from `GET /threads/:id`. The differences:

- `show` prints a detail card (ID, Project, Status, Archived, Created, Updated).
- `status` prints a summary line (ID, Status, Project, Parent, Updated) plus optional recent events.
- With `--json`, `show` returns the raw Thread object. `status` returns `{ thread, recentEvents? }`.

These are confusingly overlapping. An agent or user has to guess which one to use.

**Recommendation:** Merge into a single `bb thread show` command that subsumes `status`:
- Default behavior: show the thread detail card (current `show` behavior).
- `--recent-events <count>`, `--event-mode`, `--include-low-signal`: event inspection (current `status` behavior).
- `--json` always returns the full payload `{ thread, recentEvents? }`.
- Deprecate `bb thread status` in favor of `bb thread show`.

### `bb thread tell` vs `bb thread steer`

`steer` is identical to `tell` except it sets `mode: "steer"` in the request body. They share the same `postThreadMessage` helper.

**Recommendation:** Merge `steer` into `tell` with a `--mode steer` flag. Deprecate `bb thread steer` as a standalone command.

## 3. Inconsistent argument patterns

### Positional vs optional thread ID

Some commands take thread ID as required positional: `tell <id>`, `steer <id>`, `commit <id>`, `squash-merge <id>`, `stop <id>`, `promote <id>`.

Others take it as optional positional defaulting to `BB_THREAD_ID`: `show [id]`, `status [id]`, `output [id]`, `log [id]`, `wait [id]`, `update [id]`, `archive [id]`, `unarchive [id]`, `delete [id]`, `demote [id]`, `sessions [id]`.

The inconsistency is that commands which modify thread state (`tell`, `commit`, `stop`) require explicit IDs while read commands default to env. This is actually a reasonable safety pattern, but it's not consistently applied: `archive`, `unarchive`, and `delete` are destructive but default to `BB_THREAD_ID`.

**Recommendation:** Document the pattern explicitly. For destructive mutations (`delete`, `archive`), requiring explicit ID would be safer. For `tell`, `commit`, `stop`, `squash-merge`, `promote` - allowing optional ID with `BB_THREAD_ID` fallback would improve ergonomics for agents running in a thread context.

### `bb manager hire` accepts `[projectId]` positionally AND `--project <id>` as flag

This is the only command with a dual positional/flag pattern for project ID. It creates confusion about which takes precedence.

**Recommendation:** Remove the positional `[projectId]` argument. Use `--project` only, consistent with all other commands.

### `bb manager list` has the same `[projectId]` vs `--project` duality

Same issue.

**Recommendation:** Same fix.

## 4. Commands missing from CLI that exist in API

| API Endpoint | Description | CLI Command |
|-------------|-------------|-------------|
| `GET /threads/:id/work-status` | Get thread work status (git state) | **Missing**. Useful for agents checking if work is committed/merged. |
| `GET /threads/:id/git-diff` | Get git diff for a thread | **Missing**. Useful for code review workflows. |
| `GET /threads/:id/merge-base-branches` | Get available merge-base branches | **Missing**. Useful before squash-merge. |
| `GET /threads/:id/default-execution-options` | Get default execution options | **Missing**. Useful for agents to discover defaults. |
| `PATCH /projects/:id` | Update a project | **Missing**. Can update name, rootPath, projectInstructions, defaultProviderId. |
| `DELETE /projects/:id` | Delete a project | **Missing**. |
| `GET /projects/:id` | Get a single project | **Missing** (only `list` exists). |
| `GET /projects/:id/workspace-status` | Get project workspace status | **Missing**. |
| `GET /system/status` | Get daemon status (running threads, uptime) | **Missing**. `daemon health` exists but `status` is a lighter endpoint. |
| `GET /system/environments` | List environment types | **Missing**. |
| `GET /environments` | List environment records | **Missing**. |
| `GET /environments/:id` | Get environment by ID | **Missing**. |
| `POST /threads/:id/read` | Mark thread as read | **Missing**. UI-only concern, low priority for CLI. |
| `POST /threads/:id/unread` | Mark thread as unread | **Missing**. UI-only concern, low priority for CLI. |
| `POST /threads/:id/queue` | Enqueue follow-up message | **Missing**. Used by UI for queued messages. |

## 5. Commands that return no useful output for programmatic use

These commands succeed silently or with only human text, making them hard to script:

- `bb thread stop` - prints "Thread X stopped" but no structured response.
- `bb thread archive` / `unarchive` - prints confirmation text only.
- `bb thread commit` / `squash-merge` - uses `printThreadOperationResult` which formats as text. The underlying API returns a structured `ThreadOperationResponse`.
- `bb thread promote` / `demote` - prints result message but not the structured response.

---

# Improvement Proposals

## Consistency fixes

### C1: Add `--json` to all commands (P0)

Add `--json` flag to every command that doesn't have it. For simple confirmation commands (`stop`, `archive`, `unarchive`, `delete`, `promote`, `demote`), return the API response as JSON. For `commit`/`squash-merge`, return the `ThreadOperationResponse`. For `wait`, return the final state/event that was matched.

Commands to update: `status`, `project files`, `thread wait`, `thread commit`, `thread squash-merge`, `thread stop`, `thread archive`, `thread unarchive`, `thread delete`, `thread promote`, `thread demote`, `thread promote-status`, `manager delete`, `daemon restart`.

### C2: Normalize thread ID argument pattern (P2)

Make thread ID consistently optional (defaulting to `BB_THREAD_ID`) for all thread subcommands. This is the convention most thread commands already follow and is critical for agent ergonomics (agents run with `BB_THREAD_ID` set in their environment).

Commands to update: `tell`, `steer`, `commit`, `squash-merge`, `stop`, `promote`.

### C3: Remove positional `[projectId]` from manager commands (P2)

Replace `bb manager hire [projectId]` and `bb manager list [projectId]` with `--project` only, matching all other commands.

## Redundancy removal

### R1: Deprecate `bb thread steer`, merge into `bb thread tell --mode steer` (P1)

Add `--mode <mode>` flag to `tell` with values `tell` (default) and `steer`. Keep `steer` as a hidden alias for one release cycle, then remove.

### R2: Deprecate `bb manager threads`, `bb manager send`, `bb manager log` (P2)

These are redundant with `bb thread list --parent-thread`, `bb thread tell`, and `bb thread log` respectively. The `thread` variants are more capable (more flags, better formatting).

Keep `bb manager hire`, `bb manager list`, `bb manager status`, `bb manager delete` as the manager-specific surface.

### R3: Merge `bb thread show` and `bb thread status` into one command (P2)

Merge into `bb thread show` with the event inspection flags from `status`. Deprecate `bb thread status`.

## Missing capabilities

### M1: Add `bb thread work-status [id]` (P1)

Expose `GET /threads/:id/work-status`. Returns git workspace state (clean, dirty, unmerged, etc.). Critical for agents deciding whether to commit/merge.

Flags: `--json`, `--merge-base-branch <branch>`.

### M2: Add `bb thread git-diff [id]` (P1)

Expose `GET /threads/:id/git-diff`. Returns diff content. Critical for code review workflows.

Flags: `--json`, `--selection <type>` (combined|commit), `--commit-sha <sha>`, `--merge-base-branch <branch>`.

### M3: Add `bb project show <id>` (P1)

Expose `GET /projects/:id`. Agents need to inspect a single project.

Flags: `--json`.

### M4: Add `bb project update <id>` (P2)

Expose `PATCH /projects/:id`. Update name, root path, project instructions, default provider.

Flags: `--json`, `--name <name>`, `--root <path>`, `--project-instructions <text>`, `--default-provider <id>`.

### M5: Add `bb project delete <id>` (P2)

Expose `DELETE /projects/:id`. Agents managing project lifecycle need this.

Flags: `--json`, `--yes`.

### M6: Add `bb thread merge-base-branches [id]` (P2)

Expose `GET /threads/:id/merge-base-branches`. Useful before squash-merge operations.

Flags: `--json`.

### M7: Add missing backend flags to spawn/tell (P1)

- `bb thread spawn`: add `--service-tier`, `--sandbox-mode`, `--developer-instructions`.
- `bb thread tell`: add `--service-tier`, `--sandbox-mode`, `--demote-primary-if-needed`.
- `bb thread update`: add `--merge-base-branch`.

### M8: Add `bb daemon status` (P2)

Expose `GET /system/status` as a lightweight alternative to `daemon health`.

Flags: `--json`.

### M9: Add `--include-work-status` to `bb thread list` (P2)

Backend already supports the `includeWorkStatus` query parameter. Surface it.

## Design improvements

### D1: Add `--json` to `bb project files` with structured output (P1)

Currently outputs bare file paths. With `--json`, should return the full `ProjectFileSuggestion[]` array with path and any metadata.

### D2: Structured wait result (P1)

`bb thread wait` should return a structured result when `--json` is used:
```json
{
  "threadId": "...",
  "matched": true,
  "target": { "kind": "status", "status": "idle" },
  "elapsedMs": 1234
}
```

### D3: Exit codes for thread wait should be documented (P2)

`thread wait` uses exit code 2 for timeout and 3 for invalid request. These should be documented in `--help` output.

---

# `--json` Enforcement Proposal

## Option A: Shared command factory (recommended)

Create a helper that wraps Commander.js command creation and adds `--json` automatically:

```typescript
// commands/helpers.ts
export function createSubcommand(parent: Command, name: string, description: string): Command {
  return parent
    .command(name)
    .description(description)
    .option("--json", "Print machine-readable JSON output");
}
```

All commands use this factory instead of raw `.command()`. The only exception is `environment-agent` (long-running server, documented exclusion).

## Option B: Introspection test

Add a test that walks the Commander.js command tree and asserts every leaf command has `--json`:

```typescript
// apps/cli/src/__tests__/json-flag.test.ts
import { program } from "../index.js";

const EXCLUDED_COMMANDS = new Set(["environment-agent"]);

function collectLeafCommands(cmd: Command, prefix = ""): Array<{ path: string; cmd: Command }> {
  const results: Array<{ path: string; cmd: Command }> = [];
  for (const sub of cmd.commands) {
    const fullPath = prefix ? `${prefix} ${sub.name()}` : sub.name();
    const children = sub.commands;
    if (children.length === 0) {
      results.push({ path: fullPath, cmd: sub });
    } else {
      results.push(...collectLeafCommands(sub, fullPath));
    }
  }
  return results;
}

test("all CLI commands support --json", () => {
  const commands = collectLeafCommands(program);
  const missing: string[] = [];
  for (const { path, cmd } of commands) {
    if (EXCLUDED_COMMANDS.has(path)) continue;
    const hasJson = cmd.options.some((opt) => opt.long === "--json");
    if (!hasJson) missing.push(path);
  }
  expect(missing).toEqual([]);
});
```

## Recommendation

Use **both**. The factory (Option A) makes it easy to do the right thing. The test (Option B) catches regressions when someone bypasses the factory or adds commands manually.

---

# Prioritized Task List

## P0 — Consistency and foundation

- [ ] Add `--json` to `bb thread commit`
- [ ] Add `--json` to `bb thread squash-merge`
- [ ] Add `--json` to `bb thread stop`
- [ ] Add `--json` to `bb thread archive`
- [ ] Add `--json` to `bb thread unarchive`
- [ ] Add `--json` to `bb thread delete`
- [ ] Add `--json` to `bb thread wait`
- [ ] Add `--json` to `bb thread promote`
- [ ] Add `--json` to `bb thread demote`
- [ ] Add `--json` to `bb thread promote-status`
- [ ] Add `--json` to `bb status`
- [ ] Add `--json` to `bb project files`
- [ ] Add `--json` to `bb manager delete`
- [ ] Add `--json` to `bb daemon restart`
- [ ] Create `--json` enforcement test (Option B)

## P1 — Missing capabilities for agent workflows

- [ ] Add `bb thread work-status [id]` command (M1)
- [ ] Add `bb thread git-diff [id]` command (M2)
- [ ] Add `bb project show <id>` command (M3)
- [ ] Add `--service-tier` to `bb thread spawn` (M7)
- [ ] Add `--sandbox-mode` to `bb thread spawn` (M7)
- [ ] Add `--developer-instructions` to `bb thread spawn` (M7)
- [ ] Add `--service-tier`, `--sandbox-mode`, `--demote-primary-if-needed` to `bb thread tell` (M7)
- [ ] Add `--merge-base-branch` to `bb thread update` (M7)
- [ ] Merge `bb thread steer` into `bb thread tell --mode steer` (R1)
- [ ] Add `--include-work-status` to `bb thread list` (M9)

## P2 — Cleanup and polish

- [ ] Deprecate `bb manager threads` (R2)
- [ ] Deprecate `bb manager send` (R2)
- [ ] Deprecate `bb manager log` (R2)
- [ ] Merge `bb thread show` and `bb thread status` (R3)
- [ ] Remove positional `[projectId]` from `bb manager hire` and `bb manager list` (C3)
- [ ] Normalize thread ID to optional `[id]` in `tell`, `commit`, `squash-merge`, `stop`, `promote` (C2)
- [ ] Add `bb project update <id>` command (M4)
- [ ] Add `bb project delete <id>` command (M5)
- [ ] Add `bb thread merge-base-branches [id]` command (M6)
- [ ] Add `bb daemon status` command (M8)
- [ ] Document exit codes for `bb thread wait` in help text (D3)
- [ ] Create shared command factory with automatic `--json` (Option A)

---

# Validation

- For `--json` additions: run `bb <command> --help` and verify `--json` appears; run the command with `--json` and verify valid JSON output.
- For new commands: verify they hit the correct API endpoint and return expected data in both human and JSON modes.
- For deprecations: verify the deprecated command still works but prints a deprecation warning to stderr.
- For the enforcement test: verify it catches a command with `--json` intentionally removed.

# Open Questions/Risks

- Should deprecated commands (`manager threads`, `manager send`, `manager log`, `thread steer`, `thread status`) be removed immediately or kept as hidden aliases for one release cycle?
- Should `bb thread tell` with `--mode steer` support the same `<id> <message>` positional pattern, or should the message be `--prompt` to allow future extensibility?
- Should `--developer-instructions` on `bb thread spawn` accept a file path (`@path/to/file`) or only inline strings?
- The `bb environment-agent` command is a long-running server and intentionally lacks `--json`. Should it be moved to a separate binary or kept in `bb`?
- Should `bb project files` return `ProjectFileSuggestion[]` (with metadata) or just string paths in `--json` mode?
