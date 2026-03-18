# Goal

Make the `bb` CLI the best possible interface for both agents and users to operate bb. The CLI is the secret sauce — managers and worker threads use it as their primary way to interact with the system. Getting it right means agents work well; getting it wrong means the whole manager feature underperforms.

**Inclusion rule:** Expose API endpoints that support agent or product workflows. Internal plumbing and UI-only concerns are excluded.

# Scope

In scope:

- `bb guide` command — standalone orientation for agents and users
- `bb status` as the rich context-awareness command
- Guide template freshness (stale after CLI changes)
- Manager instructions: concise CLI reference vs full guide
- Agent base instructions: CLI awareness hint
- Remaining command table and completed audit items (reference)

Out of scope:

- QA scenarios (tracked in manager-v1-punch-list.md)
- The `bb environment-agent` command (long-running server)

# Implementation Steps

## 1. `bb guide` command

Add a `bb guide` command that renders the system overview and CLI guide templates as a single output. This is the "how does bb work and what can I do with it" command.

**Implementation:**
- New command in `apps/cli/src/commands/guide.ts`
- Renders `bbSystemOverview` + `bbCliGuide` templates via `renderTemplate()`
- Human output: print the rendered markdown to stdout
- `--json` output: `{ systemOverview: string, cliGuide: string }`
- Register in `apps/cli/src/index.ts`

**The same templates serve three contexts:**
1. `bb guide` — standalone CLI output for any agent or user
2. Manager instructions — inlined as reference sections
3. Future: hinted at in agent base instructions

## 2. `bb status` as the orientation command

Currently `bb status` just prints project ID and thread ID. It should be the command any agent runs to understand its full context.

**Proposed output:**

For a manager thread:
```
Project: my-app (proj_abc123)
  Root: /Users/me/projects/my-app

Thread: thr_def456 (Manager)
  Status: idle
  Type: manager
  Workspace: ~/.beanbag/workspace/thr_def456

Managed threads: 3
  thr_ghi789  active  "Implement settings page"
  thr_jkl012  idle    "Fix login bug"
  thr_mno345  idle    "Update README"
```

For a worker thread:
```
Project: my-app (proj_abc123)
  Root: /Users/me/projects/my-app

Thread: thr_ghi789 (Standard)
  Status: active
  Type: standard
  Parent: thr_def456 (Manager)
  Environment: /Users/me/projects/my-app/.bb/worktrees/thr_ghi789
```

For no context:
```
Project: <unset>
Thread: <unset>

Run bb guide for help getting started.
```

**Implementation:**
- Update `apps/cli/src/commands/status.ts` to fetch thread and project details from the daemon (not just env vars)
- If `BB_THREAD_ID` is set, fetch thread details and show type, status, parent, environment
- If thread is a manager, also list managed children
- If `BB_PROJECT_ID` is set, fetch and show project name and root
- `--json` returns the full structured payload
- Falls back gracefully if daemon is unreachable (just print env vars like today)

## 3. Fix `bb --help` quick start (DONE)

The quick start section in `bb --help` referenced `bb thread status` which was removed. Fixed to `bb thread show`.

## 4. Update guide templates for freshness

The CLI guide (`bb-cli-guide.md`) is stale after our changes. Update:

- Remove `bb thread status` (merged into `show`)
- Remove `bb thread steer` reference (use `tell --mode steer`)
- Add `bb project show`, `bb project update`, `bb project delete`
- Add `bb provider list`, `bb provider models`
- Document `--self` flag on mutating commands
- Document `--work-status`, `--git-diff`, `--merge-base-branches` on `thread show`
- Add `bb guide` and `bb status` to the reference
- Note the context label behavior (read-only commands print source when using env fallback)

The system overview (`bb-system-overview.md`) is still current — no changes needed.

## 5. Manager instructions: concise CLI reference

Currently the manager instructions inline the full CLI guide. This is a lot of tokens for something the agent can get from `bb guide` and `bb <cmd> --help`.

**Proposal:** Replace the full CLI guide injection with a concise reference section that covers:
- The most important commands for delegation (spawn, tell, list, show, log)
- A note to run `bb guide` for the full reference
- A note to run `bb <cmd> --help` for flag details

This saves tokens in the manager prompt while keeping the full reference accessible.

**Changes:**
- `manager-agent-instructions.md`: replace `{{{bbCliGuide}}}` with a shorter inline reference + hint
- Keep `{{{bbSystemOverview}}}` and `{{{bbManagerWorkflows}}}` as-is (these are behavioral, not reference)
- Remove `bbCliGuide` from the template variables if no longer inlined

## 6. Agent base instructions: CLI awareness

Currently the agent base instructions are one line: "You are a coding agent working on a project thread. Follow the instructions carefully and write clean, working code."

Workers should know bb exists. Add a brief hint:

```
You are running inside bb, an agent orchestration tool. Use `bb status` to see your context and `bb guide` for help with the CLI. Use `bb thread commit --self` to commit your work when done.
```

This is not a full CLI guide — just enough for a worker to orient itself and know how to commit.

## 7. Regenerate templates after changes

After updating the template markdown files:
1. Run `node packages/templates/scripts/generate-templates.mjs`
2. Update `packages/templates/src/registry.ts` if template variables changed
3. Update `apps/server/src/manager-thread.ts` if manager instruction variables changed
4. Typecheck and test

---

# Completed Audit Items (reference)

All previous audit items are done:

- `--json` on all commands (enforced by test)
- Redundant commands removed (`thread status`, `thread steer`, `manager threads/send/log/show`)
- Thread ID safety policy (`--self` flag, context labels, explicit ID for destructive ops)
- Missing capabilities added (`thread show --work-status/--git-diff/--merge-base-branches`, `project show/update/delete`)
- Missing flags added (`--service-tier`, `--sandbox-mode`, `--reasoning-level`, `--merge-base-branch`, `--include-work-status`, `--include-archived`)

# Validation

- `bb guide` output should be readable and accurate as standalone documentation
- `bb status` should give useful context for managers, workers, and bare shells
- Manager prompt token count should decrease after replacing full guide with concise reference
- Agent base instructions should mention bb without being verbose
- All template tests pass after regeneration
- `--json` enforcement test still passes

# Open Questions/Risks

- Should `bb guide` also include the manager workflows section, or just system overview + CLI reference?
- How concise can the manager CLI reference be before it hurts delegation quality? This needs behavioral QA.
- Should `bb status` fetch from the daemon or just read env vars? Fetching gives richer output but fails if daemon is down. Probably: try daemon, fall back to env vars.
