# Agent CLI Environment Plan

## Goal

Restore the provider-backed agent environment so agents can reliably run the `bb` CLI from inside their shell tools, with the expected BB context env vars set on every thread start, follow-up, and resume.

## Problem Summary

- Agents are instructed to use `bb status` and `bb guide`, but `bb` is not guaranteed to exist on the shell `PATH`.
- The runtime currently injects only partial per-thread context (`BB_PROJECT_ID`, `BB_THREAD_ID`) and does not provide a stable CLI runtime environment.
- `BB_ENVIRONMENT_ID` is documented as thread context, but is not actually injected today.
- The resume/reconfigure paths need the same env guarantees as the initial thread start path.
- The daemon already knows `BB_SERVER_URL` and `BB_HOST_DAEMON_PORT` from its own startup config; this work should derive injected shell env from daemon-local config, not from server-provided policy.

## Scope

- Make `bb` available inside agent shell execution without depending on a user-global install.
- Inject deterministic BB shell context for provider-backed threads:
  - `BB_SERVER_URL`
  - `BB_HOST_DAEMON_PORT`
  - `BB_PROJECT_ID`
  - `BB_THREAD_ID`
  - `BB_ENVIRONMENT_ID`
- Preserve the distinction between provider-process env and agent shell env.
- Verify the behavior with automated tests and a manual QA pass.

## Design Decisions

- The daemon owns all CLI path discovery, shim creation, and shell env construction.
- The runtime receives a stable shell env base plus per-thread context env.
- Reuse the existing adapter env pipeline:
  - runtime-computed shell env should flow through the current `AdapterOptions.envVars -> shell_environment_policy.set.*` mechanism
  - do not introduce a second bridge-level shell env channel
- Merge precedence is explicit:
  - per-thread BB context overrides conflicting runtime shell env keys for `BB_*`
  - `PATH` is constructed only from the runtime shell env base and is never overridden by per-thread context
- `PATH` ordering is invariant:
  - the daemon-managed shim directory must be first on start, resume, and reconfigure paths
- `environmentId` is not lazy at runtime start:
  - the server assigns an environment before queueing `thread.start`
  - host-daemon thread start/resume commands should therefore treat missing `environmentId` as invalid input rather than silently omitting `BB_ENVIRONMENT_ID`

## Proposed Changes

### 1. Add an explicit agent shell env contract in `@bb/agent-runtime`

- Add a runtime-level base shell env option in `@bb/agent-runtime`, separate from the existing provider-process `env`.
- Extend runtime thread args/config so `environmentId` is part of the per-thread execution context.
- Merge:
  - runtime-level shell env
  - per-thread BB context env
  on thread start, thread resume, and thread reconfigure paths using the precedence rules above, then feed the merged result through the existing adapter `envVars` path.
- Ensure follow-up turns continue to preserve the injected BB env.

### 2. Create a daemon-managed `bb` executable

- On host-daemon startup, create or refresh a daemon-managed `bb` executable under the daemon data dir, for example:
  - `<BB_DATA_DIR>/bin/bb`
- Prefer a symlink when the resolved CLI target is already directly executable.
- Use a small shim script only as a fallback when the local install layout requires indirection.
- The important contract is a stable `bb` executable that the daemon owns and can validate.
- Resolve the CLI entry from daemon-local installation layout at daemon startup, not from server input.
- Recreate or revalidate the daemon-managed executable on every daemon startup so it tracks the currently installed CLI location for that local install.
- In dev, a missing built CLI entry is a hard failure for daemon startup; do not silently continue with a broken executable.
- Prepend the executable directory to the agent shell `PATH` passed into the runtime and preserve that ordering on resume/reconfigure.
- Use a daemon-managed executable instead of adding an existing directory to `PATH` directly because there is no single stable pre-existing `bb` executable directory across source checkouts, packaged installs, and future sandbox/bundled layouts.

### 3. Wire the daemon runtime context

- Pass the stable shell env from host-daemon startup into `RuntimeManager` / `AgentRuntime`.
- Include:
  - `PATH` with the daemon-managed shim directory first
  - `BB_SERVER_URL`
  - `BB_HOST_DAEMON_PORT`
- Thread command handlers should pass `environmentId` through to runtime start/resume calls so `BB_ENVIRONMENT_ID` is available in-thread.
- If a start/resume command lacks `environmentId`, fail the command clearly rather than silently starting without `BB_ENVIRONMENT_ID`.

### 4. Update tests and docs

- Update tests to cover the new shell env contract and `BB_ENVIRONMENT_ID`.
- Update any docs that describe thread execution context so they match the actual injected env.
- Keep the instructions that tell agents to run `bb status` / `bb guide`; the environment should make those instructions true again.

### 5. Security and trust model notes

- Create the shim directory with owner-only write permissions (`0700` directory, executable shim file).
- Refresh the daemon-managed `bb` executable on every daemon startup.
- Document that this is not a privilege boundary:
  - provider-backed agents already execute arbitrary commands as the same user as the daemon
  - exposing `BB_SERVER_URL` and `BB_HOST_DAEMON_PORT` is intentional because the product expectation is that agents can use the `bb` CLI and daemon-local operations
  - this work does not change existing server auth or daemon localhost-only access assumptions; it only makes the intended BB control surface available to provider-backed agents
- Do not add any new server-owned policy for the injected values; the daemon should derive them from its own local config and startup arguments.

## Implementation Steps

1. Extend `@bb/agent-runtime` types and runtime internals for global shell env plus per-thread `environmentId`, with explicit merge precedence.
2. Update host-daemon startup/app wiring to resolve the local CLI entry, create or validate the daemon-managed `bb` executable, and pass stable shell env into the runtime layer.
3. Update host-daemon thread command handlers to pass `environmentId` into runtime start/resume and reject missing values.
4. Add or update automated tests in the affected packages, including negative coverage for missing CLI entry and missing `environmentId`.
5. Run targeted build/test validation.
6. Run manual QA against a standalone server + daemon instance.
7. Create or update `qa/manual-pass-log.md` with the manual QA result when the implementation is complete.

## Automated Verification

### Build

```bash
pnpm exec turbo run build --filter=@bb/agent-runtime --filter=@bb/host-daemon --filter=@bb/cli --filter=@bb/server --force > /tmp/bb-agent-cli-env-build.txt 2>&1
```

Review `/tmp/bb-agent-cli-env-build.txt` and confirm the filtered builds completed successfully.

### Tests

```bash
pnpm exec turbo run test --filter=@bb/agent-runtime --filter=@bb/host-daemon --force > /tmp/bb-agent-cli-env-tests.txt 2>&1
```

Review `/tmp/bb-agent-cli-env-tests.txt` and confirm the relevant suites passed.

### Expected automated coverage

- `@bb/agent-runtime`
  - start path merges stable shell env with thread context env
  - resume path rehydrates the same env
  - reconfigure/follow-up path preserves BB env
  - `BB_ENVIRONMENT_ID` is injected alongside `BB_PROJECT_ID` and `BB_THREAD_ID`
  - per-thread BB context overrides conflicting runtime shell env `BB_*` values
  - `PATH` remains shim-first on start, resume, and reconfigure paths
- `apps/host-daemon`
  - daemon creates/refreshes the `bb` shim
  - runtime receives shell env with shimmed `PATH`
  - thread handlers pass `environmentId` into runtime start/resume calls
  - daemon startup fails clearly when the CLI entry cannot be resolved
  - thread start/resume rejects missing `environmentId`

## Manual QA

Use the standalone flow from [`qa/manual-runbook.md`](/Users/michael/.codex/worktrees/385e/bb/qa/manual-runbook.md).

### Prerequisites

```bash
pnpm exec turbo run build --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/cli --force
node scripts/qa/cleanup-standalone.mjs
START_JSON=$(node scripts/qa/start-standalone.mjs)
printf '%s\n' "$START_JSON" | jq

export BB_SERVER_URL=$(printf '%s' "$START_JSON" | jq -r '.serverUrl')
export BB_HOST_DAEMON_PORT=$(printf '%s' "$START_JSON" | jq -r '.daemonPort')
export BB_PROJECT_ID=$(printf '%s' "$START_JSON" | jq -r '.projectId')
export STATE_PATH=$(printf '%s' "$START_JSON" | jq -r '.statePath')
export RESTART_DAEMON_COMMAND=$(printf '%s' "$START_JSON" | jq -r '.restartDaemonCommand')

alias bb="node apps/cli/dist/index.js"
```

### QA Pass 1: initial thread startup

Spawn a worker thread whose first action is to exercise the CLI from inside the provider shell:

```bash
CLI_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider codex \
  --model gpt-5 \
  --reasoning-level low \
  --service-tier fast \
  --prompt "Before answering, run \`bb status --json\`, \`bb guide\`, \`bb thread show --self --json\`, and \`env | sort | grep '^BB_'\`. Then run \`bb thread update --self --title 'CLI Self Rename Smoke'\`. Summarize the exact BB env values you observed. Do not modify files." \
  --json | jq -r '.id')

bb thread wait "$CLI_THREAD_ID" --status idle --timeout 180
bb thread show "$CLI_THREAD_ID"
bb thread output "$CLI_THREAD_ID"
bb thread log "$CLI_THREAD_ID" --format json > /tmp/bb-agent-cli-thread-log.json
```

Confirm manually:

- the thread reaches `idle`
- there is no `command not found: bb`
- the thread title changed to `CLI Self Rename Smoke`
- the thread reports concrete `BB_PROJECT_ID`, `BB_THREAD_ID`, and `BB_ENVIRONMENT_ID` values

Capture the environment ID for comparison:

```bash
CLI_ENV_ID=$(curl -fsS "$BB_SERVER_URL/api/v1/threads/$CLI_THREAD_ID" | jq -r '.environmentId')
printf 'thread=%s env=%s\n' "$CLI_THREAD_ID" "$CLI_ENV_ID"
```

Confirm the reported `BB_ENVIRONMENT_ID` matches `CLI_ENV_ID`.

### QA Pass 2: resume path after daemon restart

Restart the daemon, then send a follow-up to the same thread:

```bash
eval "$RESTART_DAEMON_COMMAND"

bb thread tell "$CLI_THREAD_ID" "Run \`bb status --json\`, \`bb thread show --self --json\`, and \`env | sort | grep '^BB_'\` again. Confirm whether the same BB context is still present after the daemon restart."
bb thread wait "$CLI_THREAD_ID" --status idle --timeout 180
bb thread output "$CLI_THREAD_ID"
bb thread log "$CLI_THREAD_ID" --format json > /tmp/bb-agent-cli-thread-log-after-restart.json
```

Confirm manually:

- the follow-up succeeds after the daemon restart
- `bb` is still available on the resumed thread
- the BB env values are still present and correct

### QA Pass 3: bridge-provider spot check

Repeat the startup smoke with one bridge-backed provider available in the local environment, preferably `claude-code`, otherwise `pi`:

```bash
BRIDGE_THREAD_ID=$(bb thread spawn \
  --project "$BB_PROJECT_ID" \
  --provider claude-code \
  --model claude-haiku-4-5 \
  --reasoning-level low \
  --prompt "Run \`bb status --json\` and \`env | sort | grep '^BB_'\`, then report the BB context you observed. Do not modify files." \
  --json | jq -r '.id')

bb thread wait "$BRIDGE_THREAD_ID" --status idle --timeout 180
bb thread output "$BRIDGE_THREAD_ID"
```

Confirm manually:

- the bridge-backed provider can also execute `bb`
- the reported BB context is populated

### QA Failure Rule

- Any failed confirmation above blocks completion of this work.
- If a QA step fails, capture the failing thread output/log snippet, fix the issue, and rerun the full affected QA pass.

### Teardown

```bash
node scripts/qa/stop-standalone.mjs --state "$STATE_PATH"
node scripts/qa/cleanup-standalone.mjs
```

## Exit Criteria

- Provider-backed agents can run `bb status` and `bb guide` from inside shell tools without `command not found`.
- `BB_SERVER_URL`, `BB_HOST_DAEMON_PORT`, `BB_PROJECT_ID`, `BB_THREAD_ID`, and `BB_ENVIRONMENT_ID` are present where expected inside thread execution.
- The initial start path, follow-up path, and resume-after-daemon-restart path all preserve BB CLI access.
- Missing CLI entry fails clearly at daemon startup rather than degrading silently.
- Missing `environmentId` fails clearly on thread start/resume rather than silently omitting `BB_ENVIRONMENT_ID`.
- Automated build/test validation passes for the touched packages.
- Manual QA is completed and recorded.
