# Thread Provisioning Lifecycle

## Problem

The current fast-create implementation keeps the durable recovery invariant, but it makes `environment_operations.kind = "provision"` carry thread-specific preparation work for managed threads. That preserves correctness, but the ownership is wrong: title inference and branch-name inference are thread creation concerns, while environment provisioning should own only host/workspace readiness.

## Target Ownership

- `thread_operations.kind = "provision"` owns the thread readiness workflow:
  - Persist and replay the original create/start intent.
  - Generate title metadata when no explicit title was supplied.
  - Generate or choose a managed branch name when a new managed workspace needs one.
  - Resolve whether this thread needs a new environment, an existing ready environment, or an existing provisioning environment.
  - Request environment provisioning when needed.
  - Request `thread.start` once the environment is ready.
  - Fail the thread durably when setup cannot proceed.

- `environment_operations.kind = "provision"` owns only environment readiness:
  - Ensure a direct host session or sandbox host session is available.
  - Queue the concrete `environment.provision` daemon command.
  - Apply daemon results to the environment.
  - Mark environment error on daemon/bootstrap failure.
  - Broadcast provisioning progress to bound live threads.

- `thread_operations.kind = "start"` remains the daemon-backed lifecycle that starts the agent session once a ready environment exists.

## Durable Flow

### POST /api/v1/threads

1. Validate project/provider/defaults.
2. Create the thread as `provisioning`.
3. Store a `thread_operations.kind = "provision"` payload containing:
   - original create request input
   - resolved provider/execution options
   - resolved environment intent
   - metadata requirements
   - initiator/source/request method
4. Fire-and-forget `advanceThreadProvisioning(threadId)`.
5. Return the thread immediately.

For fresh environments, the thread may initially have `environmentId = null` until the provisioning lifecycle creates or attaches the environment. This avoids creating `environment.status = "provisioning"` before a concrete environment operation exists.

### advanceThreadProvisioning

1. Load the active thread provision operation.
2. If metadata has not been resolved, generate title/branch metadata and update the operation payload.
3. Resolve or create the environment:
   - Reuse ready environment: attach thread, append cwd/branch provisioning event, request `thread.start`, complete thread provision operation.
   - Reuse provisioning environment: attach thread, append waiting event, leave operation active.
   - Fresh unmanaged direct-host: create env + concrete env provision op immediately.
   - Fresh managed direct-host: create env + concrete env provision op with the resolved branch name.
   - Fresh sandbox-host: create host/env + concrete sandbox env provision op with the resolved branch name.
4. If the attached environment is ready, request `thread.start`.
5. If the environment is still provisioning, wait for a sweep or environment result notification to advance again.

### Environment Result Handling

The environment result handler should no longer own starting all pre-start threads directly. It should:

1. Mark the environment ready/error.
2. Append environment provisioning progress/failure events to bound live threads.
3. Wake or advance thread provision operations bound to the environment.

Thread start is requested by `advanceThreadProvisioning`, not by environment result handling.

## Recovery Semantics

- Lost daemon results: unchanged; command-result handlers are still command-id and operation-state gated.
- Expired commands: unchanged for environment/start operations; sweepers re-advance active operations.
- Reconnect reconciliation: thread provisioning sweep advances active `thread_operations.kind = "provision"` and requests/observes environment operations as needed.
- Repeated requests: upsert/dedupe per thread provision operation; environment reuse never starts a second environment provision operation.
- Server crash after POST: the active thread provision operation is durable and will be picked up by the thread provisioning sweep.

## Failure Semantics

- Metadata failure should fall back when possible:
  - title generation failure: continue without title.
  - branch generation failure: use deterministic `bb/<threadId>` branch.
- Environment provisioning failure should:
  - mark the environment operation failed and environment `error`
  - append failed provisioning event to bound live threads
  - fail active thread provision operations bound to that environment
  - append `thread_provisioning_failed` system error events
  - transition affected pre-start/provisioning threads to `error`
- Thread start failure remains owned by the existing `thread.start` lifecycle.

## Implementation Steps

1. Revert the `managed-thread` environment provision request payload and keep environment provision requests concrete.
2. Add `provision` to `ThreadOperationKind`.
3. Add `thread-provisioning.ts` lifecycle module with request/advance/complete/fail helpers.
4. Move metadata inference into the thread provisioning lifecycle.
5. Update `createThreadFromRequest` and sandbox/reuse helpers to create thread provision operations instead of doing provisioning work inline.
6. Update environment command-result handling to notify/advance thread provision operations instead of directly starting threads.
7. Add a thread provisioning sweep to `periodic-sweeps.ts`.
8. Keep provisioning transcript projection per thread, but make it clear that environment events are being projected into the waiting thread.

## Validation

- Fast POST tests for fresh direct unmanaged, fresh direct managed, fresh sandbox, reuse ready, and reuse provisioning.
- Durable recovery tests for:
  - active thread provision operation after server restart/sweep
  - metadata fallback
  - env failure fanout to attached provisioning threads
  - reuse provisioning does not duplicate env operations
  - environment result no longer directly starts threads without a thread provision operation
- Existing checks:
  - `pnpm exec turbo run typecheck --filter=@bb/server`
  - focused server provisioning/thread tests through Turbo.
