# Pending Interaction Transport Redesign

## Goal

Move pending-interaction resolution delivery off long-lived HTTP requests and onto the existing daemon command/result lifecycle.

The server should persist and own the interaction lifecycle. The daemon should own the live provider request handle. User resolution should travel from server to daemon as a durable command, not as the eventual response body of a long-polling request.

## Current Problem

The current transport couples three lifetimes:

- the provider's in-flight JSON-RPC request
- the daemon/runtime callback waiting to answer that provider request
- the server's HTTP request waiting for the user to resolve the interaction

That makes request abort semantics ambiguous. If the HTTP request aborts, the server cannot know whether the provider request is still alive unless the daemon has a separate durable pending-request registry. Treating the abort as terminal can cancel a valid prompt. Treating the abort as non-terminal can leave a UI prompt that no provider request can receive.

The long-poll also does not match the rest of the server/daemon architecture. Other durable async work is requested by the server, delivered to the daemon as commands, and acknowledged through command results.

## Target Model

Registration and resolution delivery become separate operations:

- daemon registers the provider's interactive request with the server
- server persists the pending interaction and returns quickly
- daemon keeps a local pending-request registry keyed by the provider request identity
- user resolves the interaction through UI or CLI
- server validates and records the resolution intent
- server queues an `interactive.resolve` daemon command
- daemon consumes the command and resolves the local provider request
- daemon reports command success or failure
- server settles the interaction lifecycle based on the command result

The provider request is still not durable across daemon or provider process death. If the daemon loses the local request handle, the server must interrupt the interaction rather than pretending it can still be resolved.

## Lifecycle Ownership

### Server

- owns pending interaction rows
- validates registration and resolution payloads
- enforces project, thread, provider, and permission policy
- queues resolution delivery commands
- handles command-result acknowledgement
- interrupts interactions on thread stop, thread deletion, provider exit, daemon restart, session replacement, and session lease expiry

### Host Daemon

- translates provider requests into domain pending-interaction payloads
- registers provider requests with the server
- keeps live provider request deferreds in memory
- handles `interactive.resolve` commands
- translates domain resolutions back into provider wire responses
- reports stale or missing provider request handles as command failures

### Runtime Adapters

- decode provider interactive requests into domain payloads
- encode domain resolutions into provider JSON-RPC responses
- never own server product policy

## Proposed Protocol Shape

### Register request

The current internal request should become a fast registration call:

```ts
POST /internal/session/interactive-request
```

Request carries:

- `sessionId`
- `hostId`
- `threadId`
- `providerId`
- `providerThreadId`
- `providerRequestId`
- `payload`

Response carries:

- `interactionId`
- `status`

Registration must be idempotent for the same live provider request. If the daemon retries because the HTTP response was lost, the server should return the existing pending interaction rather than creating a duplicate or rejecting a valid retry.

### Resolve command

Add a daemon command:

```ts
kind: "interactive.resolve"
```

Command payload carries:

- `interactionId`
- `threadId`
- `providerId`
- `providerThreadId`
- `providerRequestId`
- `resolution`

The daemon succeeds only if the matching provider request handle is still live. If the handle is missing, the daemon returns a stale-request failure and the server interrupts the interaction with a clear reason.

### Command result

The command result must distinguish:

- delivered to provider
- stale provider request
- provider response encoding error
- provider process exited
- daemon/session mismatch

The server should map terminal delivery failures to `interrupted`, not `resolved`.

## Lifecycle States To Decide

The current `pending -> resolved | interrupted | expired` model may be too coarse once resolution delivery is asynchronous.

Consider adding an intermediate state:

```ts
pending -> resolving -> resolved
pending -> interrupted
resolving -> interrupted
```

`resolving` would mean: the user answered and the server queued delivery to the daemon, but the provider has not acknowledged the response yet.

Without `resolving`, the server would mark the interaction `resolved` before it knows whether the provider received the answer. That may be acceptable if timeline language says "User answered" rather than "Provider accepted", but the lifecycle should make that decision explicit.

## Recovery Rules

### Lost registration response

Daemon retries registration with the same provider request identity. Server returns the existing pending interaction if it is still pending and belongs to the same session/thread/provider scope.

### HTTP abort after registration

No terminal state change. Registration is complete, and resolution delivery no longer depends on that HTTP request.

### Daemon restart or session replacement

Server interrupts pending interactions for provider requests owned by the previous daemon session, because the local provider request handles are gone.

Same-instance replacement must still be treated carefully. If a daemon replaces a session and omits a previously active thread from its active thread list, the server should interrupt pending interactions for that missing thread.

### Provider process exit

Daemon reports process exit and interrupts any locally registered pending provider requests for that thread.

### Thread stop or deletion

Server interrupts pending interactions before stopping or deleting thread resources. Deletion must emit an interrupted event before DB cascade removes rows.

### Session lease expiry

Periodic sweeps should interrupt pending interactions for hosts whose daemon lease expired. This addresses hard-kill cases without imposing arbitrary user-facing expiry on persistent-host prompts.

### Ephemeral host expiry

Ephemeral hosts may still need bounded pending-interaction expiry because the compute resource has a bounded lifetime. That expiry should be documented as resource-lifecycle cleanup, not HTTP timeout handling.

### Resolve command lost or delayed

The existing command lifecycle should own retry, expiry, and reconciliation. A pending interaction in `resolving` should not stay there forever; command expiry should transition it to `interrupted` with a reason that the resolution could not be delivered.

## Implementation Phases

### Phase 1: Document Current Transport

- Add comments or docs around the current long-poll route explaining the provider request lifetime.
- Add tests pinning the current terminal behavior on request abort so the redesign can intentionally change it.
- Identify every place that currently assumes the HTTP response is the provider response delivery mechanism.

Exit criteria:

- The current behavior is explicitly documented.
- There is a failing-test path ready for the redesign rather than ambiguous behavior hidden in route code.

### Phase 2: Add Daemon Pending-Request Registry

- Add a daemon-owned registry for live interactive provider requests.
- Store entries by the scoped provider request identity used by the server.
- Ensure provider process exit, thread stop, and session replacement remove entries and notify the server.

Exit criteria:

- Daemon can register and later resolve a local provider request without depending on a long-held HTTP response.
- Missing entries are reported as stale provider requests, not ignored.

### Phase 3: Convert Registration To Fast Return

- Change the internal interactive-request route to persist and return `interactionId`.
- Make registration idempotent for retry after lost response.
- Remove waiter semantics from the registration request path.

Exit criteria:

- HTTP request abort after registration does not terminally change the interaction.
- Retried registration returns the same pending row for the same live provider request.

### Phase 4: Add Resolve Command Delivery

- Add `interactive.resolve` to the host-daemon command contract.
- Queue the command when a user resolves an interaction.
- Have the daemon translate the domain resolution and answer the provider request.
- Handle stale-request failures explicitly.

Exit criteria:

- User resolution reaches the provider through command delivery.
- Server does not mark provider delivery successful when the daemon lacks the live request.
- Contract tests cover the new command on the current daemon protocol version.

### Phase 5: Decide And Implement Resolution Lifecycle State

- Decide whether to add `resolving`.
- If added, update DB schema, domain schemas, server lifecycle, CLI, app UI, and timeline events.
- If not added, update timeline and API language so `resolved` means user answer accepted by server, not provider delivery guaranteed.

Exit criteria:

- The lifecycle state language is accurate.
- UI and CLI do not misrepresent an undelivered resolution as provider-accepted.

### Phase 6: Recovery And Sweep Integration

- Interrupt pending interactions on daemon restart, session replacement, provider exit, thread stop, and thread deletion.
- Add session lease-expiry cleanup for persistent hosts.
- Keep ephemeral-host expiry only if it reflects resource lifecycle constraints.
- Ensure command expiry interrupts `resolving` interactions.

Exit criteria:

- No pending row can remain forever after the provider request handle is gone.
- Persistent-host prompts do not expire solely because an HTTP request timed out.
- Ephemeral-host cleanup is explicit and tested.

### Phase 7: Remove Long-Poll Code

- Delete server waiter code that exists only to hold HTTP requests open.
- Delete daemon long-poll request handling.
- Remove tests that assert long-poll behavior and replace them with command-delivery tests.

Exit criteria:

- No production pending-interaction path depends on an HTTP request remaining open while the user thinks.
- The only durable delivery path is the daemon command/result lifecycle.

## Validation

Automated:

- `pnpm exec turbo run typecheck --filter=@bb/server --filter=@bb/host-daemon --filter=@bb/host-daemon-contract --filter=@bb/agent-runtime`
- `pnpm exec turbo run test --filter=@bb/server`
- `pnpm exec turbo run test --filter=@bb/host-daemon-contract`
- `pnpm exec turbo run test --filter=@bb/agent-runtime`
- `pnpm exec turbo run test --filter=@bb/integration-tests --force > /tmp/pending-interaction-transport-integration.txt 2>&1`

Targeted tests:

- registration retry after lost response returns the same pending interaction
- HTTP abort after successful registration does not interrupt the interaction
- UI resolution queues an `interactive.resolve` command
- daemon resolves the matching live provider request
- stale provider request command result interrupts the interaction
- daemon restart interrupts pending interactions owned by the old session
- session lease expiry interrupts persistent-host pending interactions
- thread deletion emits interrupted timeline event before cascade removes rows
- command expiry interrupts `resolving` interactions if that state is added

Manual smoke:

- trigger a Codex approval, resolve it in the UI, and verify the provider continues
- trigger a Claude permission request, resolve it in the CLI, and verify the provider continues
- trigger an approval, restart the daemon before resolving, and verify the UI shows an interrupted interaction
- trigger an approval, resolve it, kill the provider before command delivery, and verify the server records interrupted rather than resolved

## Non-Goals

- Do not make provider JSON-RPC requests durable across daemon or provider process death.
- Do not add arbitrary expiry for persistent-host user prompts as a substitute for lifecycle cleanup.
- Do not preserve long-poll compatibility once the command-delivery path is complete.
