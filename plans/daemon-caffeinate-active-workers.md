# Daemon Caffeinate Plan for Active Workers

## Goal

Prevent the machine from entering idle sleep while daemon worker processes are active, then release sleep inhibition as soon as no workers are running.

## Scope

- Implement in daemon process lifecycle only (`apps/daemon`).
- Target macOS via `caffeinate`.
- Keep behavior unchanged on non-macOS platforms.
- Do not fail worker startup if `caffeinate` is unavailable.

## Implementation Steps

1. Add a sleep inhibitor utility in `apps/daemon/src` (for example, `sleep-inhibitor.ts`) with:
   - `acquire(threadId: string): void`
   - `release(threadId: string): void`
   - `releaseAll(): void`
   - Internal tracking for active thread IDs and a single `caffeinate` child process.
2. Start `caffeinate` only on active-thread transition `0 -> 1`:
   - Guard on `process.platform === "darwin"`.
   - Spawn `caffeinate -i` with ignored stdio.
   - Log a single warning if the command is missing or spawn fails.
3. Stop `caffeinate` on transition `1 -> 0`:
   - Kill the `caffeinate` child with `SIGTERM`.
   - Clear process handle defensively on exit/error.
4. Wire the inhibitor into `ThreadManager` lifecycle in `apps/daemon/src/thread-manager.ts`:
   - Acquire after a worker process is successfully registered in `this.processes`.
   - Release in `_handleProcessExit`.
   - Release all during `stopAll()` and any broad cleanup path.
5. Keep lifecycle robust:
   - Ignore duplicate `acquire`/`release` calls for the same thread ID.
   - Ensure cleanup is idempotent so shutdown and exit handlers can call it safely.

## Validation

1. Add unit tests for transition behavior:
   - `0->1` starts one `caffeinate` process.
   - `1->2` does not start another process.
   - `2->1` keeps inhibitor active.
   - `1->0` stops inhibitor.
2. Add/extend `ThreadManager` tests to verify acquire/release calls on:
   - Spawn success
   - Process exit
   - `stopAll()`
3. Manual validation on macOS:
   - Start daemon, spawn one thread, verify `caffeinate` appears in process list.
   - Spawn/stop multiple threads, verify only one inhibitor process exists.
   - Stop all threads, verify inhibitor process exits.

## Open Questions/Risks

- `SIGKILL`/hard crashes cannot run graceful cleanup, so inhibition teardown depends on OS process cleanup.
- Confirm whether `-i` (idle sleep prevention) is sufficient, or if policy later requires display sleep prevention as well.
