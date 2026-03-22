# Clean Slate Rebuild

## Goal

Delete the accumulated service code and rebuild from clean contract boundaries.

## Architectural Principles

### Zod schemas are the source of truth

Every contract package defines Zod schemas for its request and response payloads. Types are derived via `z.infer<>`. No hand-written interfaces that duplicate what a schema already expresses.

### Domain is small but can have Zod

`packages/domain` contains shared vocabulary types used across multiple packages. It can have `zod` as a dependency for types that need validation at multiple boundaries (e.g., `PromptInput`). But it does NOT contain API-specific request/response shapes — those belong in contracts.

### Contracts produce hono clients

Both `server-contract` and `env-daemon-contract` define Hono route types and export `hc()` clients. Route response types reference `z.infer<>` types from schemas — the Endpoint type and the Zod schema are the same definition, not two parallel ones.

### Error responses are part of the contract

Contracts define the error response shape and domain error codes. Clients know exactly what errors look like.

---

## What We Keep

| Package | Notes |
|---------|-------|
| `apps/app` | Untouched |
| `apps/cli` | Untouched |
| `packages/ui-core` | Untouched |
| `packages/tsconfig` | Untouched |
| `packages/provider-adapters` | Code stays, absorbed into `@bb/agent-runtime` later. See `plans/agent-runtime-package.md`. |
| `packages/templates` | Untouched. Note: `agent-runtime` will depend on this (provider adapters currently import from it). |
| `packages/db` | Keep schema + migrations + connection + ids. Delete repositories. Update dependency from `@bb/core` to `@bb/domain`. |

## What We Delete

| Package/Dir | Replaced by |
|---------|--------|
| `packages/core` | `packages/domain` + `packages/core-ui` shim |
| `packages/environment-daemon` | Rebuilt later from contracts |
| `packages/environment` | Rebuilt later |
| `packages/api-contract` | `packages/server-contract` |
| `packages/env-daemon-contract` | Redefined (daemon's control endpoint contract) |
| `apps/server/src/` | Rebuilt later from contracts |

---

## `packages/domain`

Shared vocabulary types. Small. Zero logic. Can have Zod schemas for types that need validation at multiple boundaries.

**Dependencies:** `zod`

**What belongs here:**

```typescript
// Core entities
Project, Thread, EnvironmentRecord

// Thread state (Thread depends on these)
ThreadStatus, ThreadType, ThreadWorkStatus, ThreadWorkState,
ThreadWorkFileChange, ThreadPrimaryCheckoutState,
ThreadProvisioningReadiness, ThreadProvisioningState,
ThreadQueuedMessage, ThreadBuiltInAction, ThreadBuiltInActionId,
ThreadTurnInitiator, ThreadExecutionOptions

// Events (the canonical event type — used by agent-runtime, server, app)
ThreadEvent, ThreadEventType, ThreadEventItem, ThreadEventItemStatus,
ThreadEventRow, ThreadEventData, ThreadEventDataForType,
AppThreadEventType, ThreadEventDataByAppType,
// ... all event data interfaces (SystemErrorEventData, etc.)

// Execution vocabulary (with Zod schemas where needed)
PromptInput (+ promptInputSchema), ReasoningLevel, SandboxMode, ServiceTier

// Provider vocabulary
ProviderCapabilities, AvailableModel,
ToolCallRequest, ToolCallResponse, DynamicTool

// Environment
EnvironmentDescriptor, EnvironmentProperties, EnvironmentCapabilities

// Utilities
assertNever
```

**What does NOT belong here:**

- API request/response shapes (`SpawnThreadRequest`, `SystemHealthReport`, etc.) → `server-contract`
- Daemon protocol types (`EnvironmentDaemonCommand`, `EnvironmentDaemonEvent`) → contracts
- View transforms (`toUIMessages`, `formatTimelineAsText`) → `core-ui` shim
- WebSocket protocol types → `server-contract`
- Runtime contracts (`ThreadOrchestrator`) → server concern

**Note on `Thread`:** `Thread` has `defaultExecutionOptions?: ThreadExecutionOptions`. `ThreadExecutionOptions` lives in domain alongside `Thread` — it's shared vocabulary (used by server, daemon, agent-runtime).

**Note on renames:** Current `ProviderToolCallRequest`/`ProviderToolCallResponse`/`ProviderDynamicTool` become `ToolCallRequest`/`ToolCallResponse`/`DynamicTool`. The `Provider` prefix is dropped — these are domain concepts, not provider-specific.

---

## `packages/server-contract`

What the server serves. Two surfaces, one package.

**Dependencies:** `@bb/domain`, `zod`, `hono`

### Zod-first route definitions

Route types reference `z.infer<>` types so the Endpoint definition and the schema are one thing, not two:

```typescript
export const spawnThreadRequestSchema = z.object({ ... });
export type SpawnThreadRequest = z.infer<typeof spawnThreadRequestSchema>;

// Endpoint output types also use z.infer or domain types — never hand-written duplicates
export type PublicApiSchema = {
  "/threads": {
    $post: Endpoint<{ json: SpawnThreadRequest }, Thread, 201>;
    // Thread comes from @bb/domain, SpawnThreadRequest from z.infer above
  };
};
```

### Error responses

```typescript
export const apiErrorSchema = z.object({
  code: z.string(),
  message: z.string(),
  retryable: z.boolean().optional(),
  details: z.unknown().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;

// Domain error codes — the closed set of error codes the server can return
export type DomainErrorCode =
  | "invalid_request"
  | "thread_not_found"
  | "project_not_found"
  | "thread_archived"
  | "inactive_session"
  | "provider_unavailable"
  | "provider_timeout"
  | "provider_rpc_error"
  | "unsupported_operation"
  | "no_active_turn"
  | "internal_error";
```

### Public API (`/api/v1/*`)

Consumed by `apps/app` and `apps/cli`.

```typescript
export function createPublicApiClient(baseUrl: string) {
  return hc<Hono<{}, PublicApiSchema, "/">>(`${baseUrl}/api/v1`);
}
```

**Owns these types (currently in `@bb/core/api-types.ts`):**
- All request types: `SpawnThreadRequest`, `TellThreadRequest`, `UpdateProjectRequest`, `CreateProjectRequest`, `UpdateThreadRequest`, `EnqueueThreadMessageRequest`, `SendQueuedThreadMessageRequest`, `ThreadOperationRequest`, `EnvironmentOperationRequest`, `SystemShutdownRequest`, `SystemRestartRequest`, `OpenPathRequest`, `OpenThreadPathRequest`
- All response types: `SystemHealthReport`, `SystemStatus`, `SystemShutdownAcceptedResponse`, `SystemShutdownBlockedResponse`, `SystemRestartAcceptedResponse`, `ThreadTimelineResponse`, `ThreadGitDiffResponse`, `ThreadToolGroupMessagesResponse`, `SendQueuedThreadMessageResponse`, `EnvironmentOperationResponse`, `PrimaryCheckoutStatus`, `ProjectFileSuggestion`, `UploadedPromptAttachment`
- Operation types: `CommitOperationOptions`, `SquashMergeOperationOptions`

### Internal API (`/internal/*`)

Consumed by env-daemon processes. Bearer token auth.

```typescript
export function createInternalApiClient(baseUrl: string, authToken: string) {
  return hc<Hono<{}, InternalApiSchema, "/">>(`${baseUrl}`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
}
```

**Owns the session protocol (currently in `env-daemon-contract/session-protocol.ts`):**
- All session message Zod schemas and `z.infer<>` types
- Session protocol constants, capability negotiation
- `EnvironmentDaemonCommand` and `EnvironmentDaemonEvent` discriminated unions (these flow through the session protocol, not through the daemon's control endpoint)
- Command envelope, ack, delivery state types

### WebSocket protocol

The server also serves a WebSocket. This can't use `hc()` — it needs its own type definitions.

```typescript
// WebSocket message types (from current core/protocol.ts)
export type ClientMessage = SubscribeMessage | UnsubscribeMessage;
export type ServerMessage = ChangedMessage;
// ... change kinds, entity types
```

---

## `packages/env-daemon-contract`

What the env-daemon's HTTP control server serves. The server makes requests TO the daemon.

**Dependencies:** `@bb/domain`, `zod`, `hono`

**The daemon's actual HTTP surface** (from `environment-daemon/http-server.ts`):

```typescript
export type DaemonControlSchema = {
  "/control/status": {
    $post: Endpoint<EmptyInput, DaemonStatusSnapshot>;
  };
  "/control/session-sync": {
    $post: Endpoint<{ json: SessionSyncRequest }, SessionSyncResponse>;
  };
  "/control/shutdown": {
    $post: Endpoint<EmptyInput, { ok: true }>;
  };
};

export function createDaemonControlClient(baseUrl: string, authToken: string) {
  return hc<Hono<{}, DaemonControlSchema, "/">>(`${baseUrl}`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
}
```

**Owns these types:**
- `DaemonStatusSnapshot` — daemon health/status
- Control request/response types for session-sync and shutdown
- Provider spec and connection types (`EnvironmentDaemonProviderSpec`, `EnvironmentDaemonConnectionTarget`)

**Does NOT own:**
- `EnvironmentDaemonCommand` / `EnvironmentDaemonEvent` — these flow through the session protocol (server→daemon via command batches in the internal API), not through the daemon's control endpoint. They live in `server-contract`.

---

## `packages/core-ui`

Temporary shim so `apps/app` and `apps/cli` keep working. Cleanup target.

**Dependencies:** `@bb/domain`, `@bb/server-contract` (for request/response types the view layer references)

**Contains (moved from `packages/core/src/`):**
- `toUIMessages()`, `UIMessage` types
- `buildThreadDetailRows()`, detail row types
- `formatTimelineAsText()`
- `extractThreadContextWindowUsage()`
- `formatEnvironmentDisplay()`, `formatEnvironmentDisplayName()`
- `buildCommitFailureFollowUpInstruction()`, squash-merge prompts
- `deriveThreadTitleFromInput()`, `outputFromThreadEvent()`
- `extractErrorMessage()`, `isRecord()` (still needed for error handling)

---

## Migration Steps

Broken codebase is fine. No backward compat.

### Step 1: Create `packages/domain`

Small package. Shared entity types, enums, event types, execution vocabulary. Has `zod` dependency for schemas like `promptInputSchema`. Zero other workspace dependencies.

### Step 2: Create `packages/server-contract`

- Define Zod schemas for all public API request/response payloads, derive types via `z.infer<>`
- Define `PublicApiSchema` route type with Endpoint output types referencing `z.infer<>` / domain types
- `createPublicApiClient()` with `hc()`
- Move session protocol schemas from current `env-daemon-contract`, including `EnvironmentDaemonCommand`/`Event`
- Define `InternalApiSchema` route type, `createInternalApiClient()` with `hc()`
- Define error response schema and domain error codes
- Define WebSocket protocol types

### Step 3: Redefine `packages/env-daemon-contract`

- Define the daemon's actual control endpoint routes (status, session-sync, shutdown)
- Zod schemas for control requests/responses
- `createDaemonControlClient()` with `hc()`

### Step 4: Create `packages/core-ui` shim

- Move view utilities from `packages/core`
- Update `apps/app` and `apps/cli` imports from `@bb/core` to `@bb/domain` / `@bb/core-ui` / `@bb/server-contract`

### Step 5: Delete

- `apps/server/src/` (keep `apps/server/package.json` as placeholder)
- `packages/environment-daemon/` entirely
- `packages/environment/` entirely
- `packages/core/` entirely
- `packages/api-contract/` entirely
- Repository layer from `packages/db` (update db dependency from `@bb/core` to `@bb/domain`)

### Step 6 (later): Rebuild

- `apps/server` from contracts
- Environment daemon runtime (uses `@bb/agent-runtime`)
- `packages/agent-runtime` from provider-adapters — see `plans/agent-runtime-package.md`
- `packages/logger`, `packages/env`
- Clean up `core-ui` shim

---

## Dependency Graph

```
                    domain (zod)
                   /      |          \
         server-contract  |  env-daemon-contract
          (domain, zod,   |   (domain, zod, hono)
           hono)          |
              |           |
         core-ui          |
    (domain, server-      |
     contract)            |
        /       \         |
    apps/app  apps/cli    |
                     agent-runtime (later)
                      (domain, templates)
```
