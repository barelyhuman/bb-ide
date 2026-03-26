# Manual QA Runbook

This runbook covers the standalone persistent-host QA pass for Phase 7.

## Prerequisites

Build the server, daemon, CLI, and integration-test dependencies:

```bash
pnpm exec turbo run build --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/cli --filter=@bb/integration-tests
```

Verify provider auth before running real-provider checks:

```bash
test -n "$OPENAI_API_KEY"
test -n "$CLAUDE_CODE_OAUTH_TOKEN"
test -f "$HOME/.codex/auth.json"
test -f "$HOME/.pi/agent/auth.json"
test -x "$HOME/.bun/bin/codex"
test -x "/opt/homebrew/bin/pi"
```

## Standalone Setup

Start an isolated server + daemon pair:

```bash
node scripts/qa/start-standalone.mjs
```

The script prints JSON with:

- `serverUrl`
- `projectId`
- `hostId`
- `projectRoot`
- `bbRoot`
- `serverPid`
- `daemonPid`
- `cleanupCommand`

Set up the CLI for the returned server URL:

```bash
export BB_SERVER_URL="http://127.0.0.1:<port>"
alias bb="node apps/cli/dist/index.js"
```

Basic health checks:

```bash
curl -fsS "$BB_SERVER_URL/api/v1/system/config"
bb status
```

Teardown:

```bash
node scripts/qa/stop-standalone.mjs --state <state-path-from-start-output>
```

## Smoke Pass

Spawn an unmanaged thread and wait for it to finish:

```bash
bb thread spawn --project <projectId> --provider codex --prompt "Say hello"
bb thread wait <threadId> --status idle --timeout 90
bb thread show <threadId>
bb thread output <threadId>
```

Send a follow-up after idle:

```bash
bb thread tell <threadId> "Now say goodbye"
bb thread wait <threadId> --status idle --timeout 90
bb thread output <threadId>
```

Create a managed worktree thread:

```bash
bb thread spawn --project <projectId> --provider codex --new-environment worktree --prompt "Create a test file"
bb thread wait <threadId> --status idle --timeout 120
bb thread show <threadId>
```

Archive and unarchive:

```bash
bb thread archive <threadId>
bb thread show <threadId>
bb thread unarchive <threadId>
bb thread tell <threadId> "Say something after unarchive"
bb thread wait <threadId> --status idle --timeout 90
```

## Multi-Thread and Shared Environment

Create a first unmanaged thread:

```bash
bb thread spawn --project <projectId> --provider codex --prompt "Thread A: say hello"
bb thread wait <threadA> --status idle --timeout 90
bb thread show <threadA>
```

Reuse that environment for a sibling thread:

```bash
bb thread spawn --project <projectId> --provider codex --environment <environmentId-from-threadA> --prompt "Thread B: say world"
bb thread wait <threadB> --status idle --timeout 90
bb thread show <threadB>
```

Interleave follow-ups:

```bash
bb thread tell <threadA> "Follow up for thread A"
bb thread tell <threadB> "Follow up for thread B"
bb thread wait <threadA> --status idle --timeout 90
bb thread wait <threadB> --status idle --timeout 90
```

Run a mixed-provider pass in separate environments:

```bash
bb thread spawn --project <projectId> --provider claude-code --prompt "Provider smoke"
bb thread spawn --project <projectId> --provider pi --new-environment worktree --prompt "Provider smoke"
```

Validate no event or workspace cross-contamination by checking `bb thread show`, `bb thread output`, and the per-thread environment IDs.

## Recovery

Graceful daemon restart:

```bash
kill -TERM <daemonPid>
node apps/host-daemon/dist/index.js
bb thread tell <threadId> "Check recovery after daemon restart"
bb thread wait <threadId> --status idle --timeout 90
```

Daemon death during active work:

```bash
bb thread tell <threadId> "Write a long detailed answer about computing history"
bb thread wait <threadId> --status active --timeout 30
kill -TERM <daemonPid>
bb thread show <threadId>
node apps/host-daemon/dist/index.js
bb thread tell <threadId> "Recover after interruption"
bb thread wait <threadId> --status idle --timeout 90
```

Inspect recovery state with:

```bash
bb thread show <threadId>
bb thread output <threadId>
tail -n 200 <logsDir>/server.log
tail -n 200 <logsDir>/host-daemon.log
```

## Provider-Specific Pass

For each provider `codex`, `claude-code`, and `pi`, run:

```bash
bb thread spawn --project <projectId> --provider <provider> --prompt "Say exactly: hello world"
bb thread wait <threadId> --status idle --timeout 120
bb thread output <threadId>
bb thread tell <threadId> "Repeat the previous answer in uppercase"
bb thread wait <threadId> --status idle --timeout 120
bb thread stop <threadId> # only after sending a long-running prompt
```

For workspace interaction, repeat on a worktree thread:

```bash
bb thread spawn --project <projectId> --provider <provider> --new-environment worktree --prompt "Create hello.txt containing hello world"
bb thread wait <threadId> --status idle --timeout 120
bb thread show <threadId>
```

Record the provider, thread ID, environment ID, and observed result for each pass.
