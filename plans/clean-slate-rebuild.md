# Clean Slate Rebuild

## Goal

Delete the accumulated service code and rebuild from clean contract boundaries.

## Architectural Principles

### Zod schemas are the source of truth

Every contract package defines Zod schemas for its request and response payloads. Types are derived via `z.infer<>`. No hand-written interfaces that duplicate what a schema already expresses. This means:

- Contracts own the types for their boundary
- Implementors validate requests with the schemas
- Clients validate responses with the schemas
- There is exactly one definition of each payload shape

### Domain is small

`packages/domain` only contains types that are genuinely shared vocabulary — the core entities and enums that multiple packages reference. If a type is specific to an API surface (request shape, response shape, route-level type), it belongs in the contract that defines that surface.

### Contracts produce hono clients

Both `server-contract` and `env-daemon-contract` define Hono route types and export `hc()` clients. The server implements the route types. Clients call through `hc()`. Type mismatches between server and client are compile errors.

---

## What We Keep

| Package | Notes |
|---------|-------|
| `apps/app` | Untouched |
| `apps/cli` | Untouched |
| `packages/ui-core` | Untouched |
| `packages/tsconfig` | Untouched |
| `packages/provider-adapters` | Code stays, absorbed into `@bb/agent-runtime` later. See `plans/agent-runtime-package.md`. |
| `packages/templates` | Untouched |
| `packages/db` | Keep schema + migrations + connection + ids. Delete repositories. |

## What We Delete

| Package/Dir | Replaced by |
|---------|--------|
| `packages/core` | `packages/domain` + `packages/core-ui` shim |
| `packages/environment-daemon` | Rebuilt later from contracts |
| `packages/environment` | Rebuilt later |
| `packages/api-contract` | `packages/server-contract` |
| `packages/env-daemon-contract` | Redefined (daemon's own HTTP contract) |
| `apps/server/src/` | Rebuilt later from contracts |

---

## `packages/domain`

Shared vocabulary types. No logic, no Zod schemas, no API-specific request/response shapes. Zero dependencies.

**What belongs here — the entities and enums that multiple packages need:**

```typescript
// Core entities
Project, Thread, EnvironmentRecord

// Thread state
ThreadStatus, ThreadType, ThreadWorkStatus, ThreadProvisioningState

// Events (the canonical event type used across all boundaries)
ThreadEvent, ThreadEventType, ThreadEventItem, ThreadEventRow

// Execution vocabulary
PromptInput, ReasoningLevel, SandboxMode, ServiceTier

// Provider vocabulary (provider ID is just string — the set of
// available providers is an agent-runtime concern, not domain)
ProviderCapabilities, AvailableModel,
ToolCallRequest, ToolCallResponse, DynamicTool

// Utilities
assertNever
```

**What does NOT belong here:**

- `SpawnThreadRequest`, `TellThreadRequest`, `UpdateProjectRequest` — API request shapes → `server-contract`
- `SystemHealthReport`, `SystemShutdownBlockedResponse`, `ThreadTimelineResponse` — API response shapes → `server-contract`
- `CommitOperationOptions`, `EnvironmentOperationRequest` — operation payloads → `server-contract`
- `EnvironmentDaemonCommand`, `EnvironmentDaemonEvent` — daemon protocol → `env-daemon-contract`
- `UIMessage`, `toUIMessages` — view layer → `core-ui` shim
- WebSocket protocol types → `server-contract`

---

## `packages/server-contract`

What the server serves. Two surfaces, one package. Zod schemas are the source of truth. Both surfaces get `hc()` clients.

**Dependencies:** `@bb/domain`, `zod`, `hono`

### Public API (`/api/v1/*`)

Consumed by `apps/app` and `apps/cli`.

```typescript
// Zod schemas define all request/response payloads.
// Types derived via z.infer<>.
export const spawnThreadRequestSchema = z.object({ ... });
export type SpawnThreadRequest = z.infer<typeof spawnThreadRequestSchema>;

// Route type definition — both server and client are typed against this.
export type PublicApiSchema = {
  "/projects": {
    $get: Endpoint<EmptyInput, Project[]>;
    $post: Endpoint<{ json: SpawnThreadRequest }, Project, 201>;
  };
  // ... all public routes
};

// Typed client
export function createPublicApiClient(baseUrl: string) {
  return hc<Hono<{}, PublicApiSchema>>(`${baseUrl}/api/v1`);
}
```

**Owns these types (currently in `@bb/core/api-types.ts`):**
- All request types: `SpawnThreadRequest`, `TellThreadRequest`, `UpdateProjectRequest`, `CreateProjectRequest`, `UpdateThreadRequest`, `EnqueueThreadMessageRequest`, `SendQueuedThreadMessageRequest`, `ThreadOperationRequest`, `EnvironmentOperationRequest`, `SystemShutdownRequest`, `SystemRestartRequest`, `OpenPathRequest`, `OpenThreadPathRequest`
- All response types: `SystemHealthReport`, `SystemStatus`, `SystemShutdownAcceptedResponse`, `SystemShutdownBlockedResponse`, `SystemRestartAcceptedResponse`, `ThreadTimelineResponse`, `ThreadGitDiffResponse`, `ThreadToolGroupMessagesResponse`, `SendQueuedThreadMessageResponse`, `EnvironmentOperationResponse`, `CommitEnvironmentOperationResponse`, `SquashMergeEnvironmentOperationResponse`, `PrimaryCheckoutStatus`, `PromotePrimaryCheckoutResponse`, `DemotePrimaryCheckoutResponse`, `ProjectFileSuggestion`, `UploadedPromptAttachment`, `AvailableModel`
- Operation options: `CommitOperationOptions`, `SquashMergeOperationOptions`
- WebSocket protocol: `ClientMessage`, `ServerMessage`, `ChangedMessage`

### Internal API (`/internal/*`)

Consumed by env-daemon processes. Bearer token auth.

```typescript
// Session protocol — Zod schemas, types derived via z.infer<>.
export const sessionOpenPayloadSchema = z.object({ ... });
export type SessionOpenPayload = z.infer<typeof sessionOpenPayloadSchema>;

// Route type definition
export type InternalApiSchema = {
  "/environments/:id/session/open": {
    $post: Endpoint<{ param: { id: string }; json: SessionOpenPayload }, SessionWelcomeMessage, 201>;
  };
  "/environments/:id/session/commands": {
    $get: Endpoint<{ ... }, SessionCommandBatchMessage>;
  };
  "/environments/:id/session/messages": {
    $post: Endpoint<{ ... }, unknown, 200 | 204>;
  };
};

// Typed client
export function createInternalApiClient(baseUrl: string, authToken: string) {
  return hc<Hono<{}, InternalApiSchema>>(`${baseUrl}`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
}
```

**Owns these types (currently in `@bb/env-daemon-contract`):**
- All session protocol schemas and derived types
- Session message envelopes
- Capability negotiation helpers

---

## `packages/env-daemon-contract`

What the env-daemon serves. The server makes requests TO the daemon's HTTP control endpoint. Zod schemas are the source of truth. `hc()` client.

**Dependencies:** `@bb/domain`, `zod`, `hono`

```typescript
// Control endpoint schemas
export const controlCommandRequestSchema = z.object({ ... });
export type ControlCommandRequest = z.infer<typeof controlCommandRequestSchema>;

// Route type definition
export type DaemonControlSchema = {
  "/command": {
    $post: Endpoint<{ json: ControlCommandRequest }, ControlCommandResponse>;
  };
  "/status": {
    $get: Endpoint<EmptyInput, DaemonStatusSnapshot>;
  };
};

// Typed client
export function createDaemonControlClient(baseUrl: string, authToken: string) {
  return hc<Hono<{}, DaemonControlSchema>>(`${baseUrl}`, {
    headers: { authorization: `Bearer ${authToken}` },
  });
}
```

**Owns these types (currently in `@bb/environment-daemon/protocol.ts`):**
- `EnvironmentDaemonCommand` (discriminated union)
- `EnvironmentDaemonEvent` (discriminated union)
- `EnvironmentDaemonCommandEnvelope`, `EnvironmentDaemonCommandAck`
- `EnvironmentDaemonStatusSnapshot`
- Control request/response types
- Provider spec and connection types
- All Zod command validation schemas

---

## `packages/core-ui`

Temporary shim so `apps/app` and `apps/cli` keep working. Cleanup target — not a permanent home.

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
- `promptInputSchema` (used by app for input validation — or moves to server-contract)

---

## Migration Steps

Broken codebase is fine. No backward compat.

### Step 1: Create `packages/domain`

Small package. Just the shared entity types and enums listed above. Zero dependencies.

### Step 2: Create `packages/server-contract`

- Define Zod schemas for all public API request/response payloads
- Derive types from schemas via `z.infer<>`
- Define `PublicApiSchema` route type, `createPublicApiClient()` with `hc()`
- Move session protocol schemas from current `env-daemon-contract`
- Define `InternalApiSchema` route type, `createInternalApiClient()` with `hc()`

### Step 3: Redefine `packages/env-daemon-contract`

- Extract daemon control endpoint types from `environment-daemon/protocol.ts`
- Define Zod schemas for control requests/responses
- Define `DaemonControlSchema` route type, `createDaemonControlClient()` with `hc()`

### Step 4: Create `packages/core-ui` shim

- Move view utilities from `packages/core`
- Update `apps/app` and `apps/cli` imports

### Step 5: Delete

- `apps/server/src/`
- `packages/environment-daemon/`
- `packages/environment/`
- `packages/core/`
- `packages/api-contract/`
- Repository layer from `packages/db`

### Step 6 (later): Rebuild

- `apps/server` from contracts
- Environment daemon runtime (uses `@bb/agent-runtime`)
- `packages/agent-runtime` from provider-adapters — see `plans/agent-runtime-package.md`
- `packages/logger`, `packages/env`
- Clean up `core-ui` shim

---

## How validation works with this architecture

**Server receives a request:**
```typescript
// Route handler validates with the contract's schema
app.post("/threads", zValidator("json", spawnThreadRequestSchema), (c) => {
  const body = c.req.valid("json"); // type is SpawnThreadRequest (z.infer)
  // ... handle
});
```

**Client sends a request:**
```typescript
// hc() client enforces the right input type at compile time
const client = createPublicApiClient("http://localhost:3334");
const res = await client.threads.$post({
  json: { projectId: "p1", input: [...] } // type-checked against SpawnThreadRequest
});
const thread = await res.json(); // type is Thread
```

**Daemon sends a session message:**
```typescript
const client = createInternalApiClient("http://localhost:3334/internal", token);
const res = await client.environments[":id"].session.open.$post({
  param: { id: envId },
  json: openPayload, // type-checked against SessionOpenPayload
});
const welcome = await res.json(); // type is SessionWelcomeMessage
```

**Server calls daemon control endpoint:**
```typescript
const client = createDaemonControlClient("http://localhost:9000", token);
const res = await client.command.$post({
  json: commandEnvelope, // type-checked against ControlCommandRequest
});
const ack = await res.json(); // type is ControlCommandResponse
```

No `as` casts, no manual JSON parsing, no `unknown`. The schema validates at the boundary. The `hc()` client types the response. Types flow through.
