# Provider Adapter: Generic Translation Layer

## Goal

Make the `ProviderAdapter` the single translation layer between bb and each provider. The adapter owns both directions:

- **Outbound**: bb types → provider-specific commands
- **Inbound**: provider-specific SDK events → bb events

Remove `interpretNotification` from the contract. bb receives strongly-typed bb events and applies its own rules (persist, broadcast, status changes). Providers don't know or care about bb's internal policies.

## Current State

```
bb server → adapter.build*Command() → bridge process → provider SDK
bb server ← interpretNotification() ← bridge emits bb events ← event-translator.ts ← provider SDK
```

The event translator (`event-translator.ts`) lives inside each bridge process and does the real work of converting SDK types to bb events. The adapter's `interpretNotification` re-interprets the already-translated events to extract status/title/persist/broadcast — which is redundant and leaky.

## Target State

```
env-daemon → adapter.build*Command() → bridge process → provider SDK
env-daemon ← adapter.translateEvent() ← bridge forwards raw events ← provider SDK
```

The adapter owns the translation. The bridge is a thin JSON-RPC shell that spawns the SDK process and forwards raw events. bb receives bb events and applies its own rules.

## Design

### ProviderRequest — bb's discriminated union for all requests

```ts
type ProviderRequest =
  | {
      type: "initialize";
      clientInfo: { name: string; version: string };
    }
  | {
      type: "thread/start";
      threadId: string;
      req: SpawnThreadRequest;
      context: ProviderThreadContext;
      dynamicTools?: ProviderDynamicTool[];
    }
  | {
      type: "thread/resume";
      threadId: string;
      providerThreadId: string | undefined;
      context: ProviderThreadContext;
      options?: ProviderExecutionOptions;
      resumePath?: string;
    }
  | {
      type: "turn/start";
      threadId: string;
      providerThreadId: string | undefined;
      input: PromptInput[];
      options?: ProviderExecutionOptions;
    }
  | {
      type: "turn/steer";
      threadId: string;
      providerThreadId: string | undefined;
      expectedTurnId: string;
      input: PromptInput[];
    }
  | {
      type: "thread/name/set";
      threadId: string;
      providerThreadId: string | undefined;
      title: string;
    };
```

Every request has a `type`. Every thread-scoped request has a `threadId`. The caller builds the request, the adapter translates it to a provider-specific command:

```ts
// caller:
adapter.buildCommand({ type: "turn/start", threadId, providerThreadId, input });

// vs the old way:
adapter.buildTurnStartCommand({ threadId, providerThreadId, input });
```

For unsupported operations (e.g. `thread/name/set` on a provider that doesn't support rename), the adapter returns `null`.

### Generic ProviderAdapter interface

```ts
interface ProviderAdapter<TProviderEvent = unknown, TProviderCommand = unknown> {
  // Identity & launch
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[] };
  resolveLaunchConfiguration?(...): ...;
  preflightSessionStart?(): ...;

  // Outbound: bb request → provider command
  buildCommand(request: ProviderRequest): TProviderCommand | null;

  // Inbound: provider event → bb events
  translateEvent(event: TProviderEvent): BbEvent[];

  // Tool call codec
  decodeToolCallRequest(args: { requestId, method, params }): ProviderToolCallRequest | null;
  encodeToolCallResponse(response: ProviderToolCallResponse): ProviderToolCallResponse;

  // Derived behavior
  listModels(): Promise<AvailableModel[]>;
  deriveThreadTitle(input?: PromptInput[]): string | undefined;
  inactiveSessionErrorMessage(threadId: string): string;
}
```

### BbEvent — the canonical event type

```ts
type BbEvent =
  | { type: "turn/started"; threadId: string; turnId: string }
  | { type: "turn/completed"; threadId: string; turnId: string; result?: { subtype: string }; error?: { message: string } }
  | { type: "item/started"; threadId: string; turnId: string; item: BbItem }
  | { type: "item/completed"; threadId: string; turnId: string; item: BbItem }
  | { type: "item/agentMessage/delta"; threadId: string; turnId: string; delta: string }
  | { type: "thread/identity"; threadId: string; providerThreadId: string }
  | { type: "thread/started"; threadId: string }
  | { type: "thread/name/updated"; threadId: string; threadName: string }
  | { type: "thread/tokenUsage/updated"; threadId: string; turnId: string; tokenUsage: BbTokenUsage }
  | { type: "error"; threadId: string; message: string };
```

This is a closed, discriminated union. bb knows every possible event type. It decides what to persist, broadcast, and how to update thread status — those are bb's rules, not the provider's.

### Per-provider adapters

Each adapter defines its own command type — strongly typed internally, opaque to bb:

```ts
// --- Codex ---

interface CodexCommand {
  method: string;
  params: {
    threadId?: string;
    approvalPolicy?: string;
    sandbox?: string;
    baseInstructions?: string;
    input?: PromptInput[];
    config?: Record<string, unknown>;
    dynamicTools?: Array<{ name: string; description: string; inputSchema: unknown }>;
    // ... codex-specific fields
  };
}

const codexAdapter: ProviderAdapter<CodexNotification, CodexCommand> = {
  buildCommand(request) {
    switch (request.type) {
      case "initialize":
        return { method: "initialize", params: { clientInfo: request.clientInfo, capabilities: { experimentalApi: true } } };
      case "thread/start":
        return { method: "thread/start", params: { approvalPolicy: "never", sandbox: "danger-full-access", ... } };
      case "turn/start":
        return { method: "turn/start", params: { threadId: request.providerThreadId ?? request.threadId, input: request.input, ... } };
      case "thread/name/set":
        return { method: "thread/name/set", params: { threadId: request.providerThreadId ?? request.threadId, name: request.title } };
      // ...
    }
  },
  translateEvent(event) {
    // codex sends well-structured events that map almost 1:1 to BbEvent
  },
};

// --- Claude Code ---

interface ClaudeCodeCommand {
  method: string;
  params: {
    threadId?: string;
    providerThreadId?: string | null;
    baseInstructions?: string;
    managerMode?: boolean;
    input?: PromptInput[];
    // ... claude-code-specific fields
  };
}

const claudeCodeAdapter: ProviderAdapter<SDKMessage, ClaudeCodeCommand> = {
  buildCommand(request) {
    // switch on request.type, return ClaudeCodeCommand
  },
  translateEvent(message) {
    // this IS the current event-translator.ts logic
  },
};

// --- Pi ---

interface PiCommand {
  method: string;
  params: {
    threadId?: string;
    baseInstructions?: string;
    sessionPath?: string;
    input?: PromptInput[];
    // ... pi-specific fields
  };
}

const piAdapter: ProviderAdapter<AgentSessionEvent, PiCommand> = {
  buildCommand(request) {
    // switch on request.type, return PiCommand
  },
  translateEvent(event) {
    // this IS the current pi event-translator.ts logic
  },
};
```

The env-daemon uses `ProviderAdapter` (defaults to `unknown`) and just serializes whatever `buildCommand` returns:

```ts
function sendToProvider(adapter: ProviderAdapter, request: ProviderRequest) {
  const command = adapter.buildCommand(request);
  if (!command) return; // unsupported (e.g. thread/name/set on claude-code)
  child.stdin.write(JSON.stringify(command) + "\n");
}
```

### Bridge simplification

The bridges become generic JSON-RPC shells:

```ts
// Generic bridge — works for any provider
function runBridge(adapter: ProviderAdapter<unknown>) {
  // Read JSON-RPC from stdin
  // For requests: forward to SDK, send response
  // For SDK events: call adapter.translateEvent(), emit BbEvents as notifications
  // For tool calls: forward to host, return response to SDK
}
```

Claude-code and pi bridges currently do SDK-specific session management (spawning queries, pushing input, managing turn counters). That stays in the bridge — the bridge owns the SDK session lifecycle. But the event translation moves to the adapter.

### bb-side changes

Remove from bb server / env-daemon:
- `interpretNotification` calls → replaced by reading `BbEvent.type` directly
- `normalizeEventType` → `BbEvent.type` is already canonical
- `shouldPersist` / `shouldBroadcast` logic → moved to a bb-owned policy:

```ts
// bb's own rules, not provider-specific
function shouldPersistEvent(event: BbEvent): boolean {
  switch (event.type) {
    case "item/agentMessage/delta": return false;
    case "thread/name/updated": return false;
    default: return true;
  }
}

function shouldBroadcastEvent(event: BbEvent): boolean {
  switch (event.type) {
    case "item/agentMessage/delta": return false;
    default: return true;
  }
}

function statusFromEvent(event: BbEvent): Thread["status"] | undefined {
  switch (event.type) {
    case "turn/started": return "active";
    case "turn/completed": return "idle";
    case "error": return "error";
    default: return undefined;
  }
}
```

These are bb's policies. Providers don't need to know about them.

### `outputFromEvent` removal

Currently on the adapter interface. This extracts agent message text from a `ThreadEvent` (bb's persisted event type). It's bb-side logic that reads persisted data — not provider translation. Move it to bb's event utilities in `@bb/core`.

## Implementation Steps

1. Define `BbEvent` discriminated union in `provider-adapter.ts`
2. Add `translateEvent` to the `ProviderAdapter` interface (generic `TProviderEvent`)
3. Move `event-translator.ts` logic into each adapter's `translateEvent` method
4. Simplify bridges — remove event translation, just forward raw SDK events and call `translateEvent`
5. Move `shouldPersist` / `shouldBroadcast` / `statusFromEvent` to bb-owned policy functions in `@bb/core` or server
6. Remove `interpretNotification` from the interface
7. Move `outputFromEvent` to `@bb/core`
8. Update `provider-session-controller.ts` and `provider-semantics.ts` to use `BbEvent` directly
9. Update integration tests — `runTurn` returns `BbEvent[]` instead of interpreted notifications
10. Remove `normalizeProviderEventType` — no longer needed

## Wait — the bridge process boundary

The bridge runs as a separate child process and communicates via JSON-RPC. The SDK types (`SDKMessage`, `AgentSessionEvent`) are available in the server process — `@bb/provider-adapters` already depends on all three SDKs. The bridge processes exist for session lifecycle isolation, not to avoid importing types.

`translateEvent` runs in the env-daemon process. The bridge forwards raw SDK events as JSON over stdout. The env-daemon calls `adapter.translateEvent()` which validates with Zod against the SDK's known shapes and translates to `BbEvent[]`. The env-daemon then forwards the `BbEvent[]` to the server. The `TProviderEvent` generic is the Zod-validated shape (which mirrors the SDK type but is parsed from JSON, not a live SDK object).

## Interface Cleanup: Remove Non-Translation Methods

Three methods on the current interface don't belong there:

### `outputFromEvent(event: ThreadEvent): string | undefined`

Extracts agent message text from a persisted `ThreadEvent`. All three adapters implement it identically using `decodeThreadEventData` from `@bb/core`. This reads bb's own persisted data — not provider translation. Move to `@bb/core` as a utility function.

### `deriveThreadTitle(input?: PromptInput[]): string | undefined`

Generates a thread title from the user's prompt. All three adapters implement it identically using `deriveThreadTitleFromInput` from adapter helpers. Not provider-specific. Move to `@bb/core` or keep in adapter helpers as a standalone utility that bb calls directly.

### `inactiveSessionErrorMessage(threadId: string): string`

Returns `"Thread X has no <provider> session"`. Trivially derivable from `displayName`:

```ts
// bb can do this itself:
`Thread ${threadId} has no ${adapter.displayName} session`
```

Remove from the interface entirely.

### `clientInfo: { name: string; version: string }`

Sent in the `initialize` JSON-RPC request. Every adapter sets it to `{ name: "bb", version: "0.0.1" }`. This is bb's identity, not the provider's. The server knows its own name and version — it should pass this into `buildInitializeCommand` rather than the adapter storing it.

Remove from the interface. The `buildInitializeCommand` args already receive `clientInfo`.

### `processCommand` / `processArgs`

How to spawn the provider's bridge process. Legitimate — each provider has a different binary/script. Collapse into a single field for clarity:

```ts
process: { command: string; args: string[] };
```

### After cleanup, the interface is:

```ts
interface ProviderAdapter<TProviderEvent = unknown, TProviderCommand = unknown> {
  // Identity & launch
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[] };
  resolveLaunchConfiguration?(...): ...;
  preflightSessionStart?(): ...;

  // Outbound: bb request → provider command
  buildCommand(request: ProviderRequest): TProviderCommand | null;

  // Inbound: provider event → bb events
  translateEvent(event: TProviderEvent): BbEvent[];

  // Tool call codec
  decodeToolCallRequest(args: { ... }): ProviderToolCallRequest | null;
  encodeToolCallResponse(response: ProviderToolCallResponse): ProviderToolCallResponse;

  // Provider capabilities
  listModels(): Promise<AvailableModel[]>;
}
```

The interface has two translation methods (`buildCommand`, `translateEvent`), two tool call methods, one capability method, and identity/launch config. Every method is provider-specific. No bb constants, no bb policy, no duplicated utility logic.

## Delete `adapter-helpers.ts`

This file should be deleted entirely. Every function in it either doesn't belong in the adapter layer or exists to support `interpretNotification` which is being removed.

| Function | Disposition |
|----------|-------------|
| `normalizeProviderEventType` | Delete — contract enforces canonical method names |
| `normalizeTitle` | Move to `@bb/core` as a string utility |
| `deriveThreadTitleFromInput` | Move to `@bb/core` |
| `resolveBaseInstructions` | Move to bb — instructions should be composed before reaching the adapter via `ProviderRequest` |
| `outputFromEvent` | Move to `@bb/core` |
| `withExecutionOptions` | Delete — each adapter handles its own param construction with its own types |
| `withThreadEnvironmentPolicy` | Delete — codex/claude-code specific wire format, not generic |
| `turnStateFromMethod` | Move to bb policy layer |
| `baseNotificationResult` | Delete — exists for `interpretNotification` which is being removed |
| `cloneDynamicTools` | Delete — trivial inline `JSON.parse(JSON.stringify(x))` |

After this, there are no "shared adapter helpers." Each adapter is self-contained with its own strongly-typed param construction. bb utilities live in `@bb/core`.

## Follow-up Work (separate from this plan)

These are not blockers for this plan but should happen soon after:

### Move `ProviderToolHost` out of this package

`ProviderToolHost` is a tool registry and executor — server-side logic, not provider translation. It registers dynamic tools and executes them when a provider asks (via `item/tool/call`). It depends only on types from this package (`ProviderToolCallRequest`, `ProviderToolCallResponse`, `ProviderDynamicTool`).

Move it to the server or its own package. The types stay here.

### Move `LlmCompletionService` to its own package

`LlmCompletionService`, `generateCodexThreadTitle`, `generateCodexCommitMessage`, `generateOpenAIResponsesText` — these are LLM inference utilities for title generation and commit messages. They use OpenAI's API directly, not the provider adapter interface. Completely separate concern.

Move to a `@bb/llm-completion` package or similar.

### Cut server off from importing this package

End state: the server imports only types from `@bb/provider-adapters`, never runtime code. Currently the server imports:
- `createProviderAdapter`, `createProviderForId`, `listAvailableProviderInfos`, `resolveDefaultProviderId` → all go through `ProviderRegistry` which the env-daemon owns
- `ProviderToolHost` → moves to server (see above)
- `LlmCompletionService` → moves to own package (see above)
- `ProviderAdapter` type, `ProviderExecutionOptions`, `ProviderThreadContext`, etc. → types stay, that's fine
- `deriveThreadTitle` → moves to `@bb/core`
- `outputFromEvent` → moves to `@bb/core`

After these moves, the server's only imports from this package are type imports.

### Make the package export surface intentional

End state exports:
- **Types**: `ProviderAdapter`, `BbEvent`, `ProviderRequest`, `ProviderToolCallRequest`, `ProviderToolCallResponse`, `ProviderDynamicTool`, `ProviderExecutionOptions`, `ProviderThreadContext`, `ProviderCapabilities`, `ProviderLaunchConfiguration`
- **One class**: `ProviderRegistry` — the only runtime export. Manages adapter instances, handles registration/lookup, delegates translation calls
- **Built-in adapter factories**: registered internally at construction, not exported. The registry exposes them by ID, not by factory function

Nobody imports `createCodexProviderAdapter` directly. Nobody calls adapter methods directly. Everything goes through the registry.

### Env-daemon receives registry, doesn't instantiate adapters

Currently `runtime.ts` calls `createProviderAdapter({ providerId })` to get adapters. Instead, the env-daemon receives a `ProviderRegistry` at construction and calls `registry.get(providerId)` or `registry.buildCommand(providerId, request)`.

## Resolved Questions

1. **Turn counter** — the adapter's `translateEvent` is stateless. It receives a raw event, returns `BbEvent[]`. If the provider event implies a new turn (e.g. Claude SDK's `type: "assistant"` message), the adapter emits `turn/started` with a turn ID derived from the event data. The env-daemon/server tracks thread/turn state — the adapter doesn't need counters.

2. **Tool call forwarding** — stays in the bridge. The bridge manages the SDK session lifecycle and the async tool call flow (provider requests tool → bridge forwards to bb → bb responds → bridge feeds result back to SDK). The adapter handles encoding/decoding via `decodeToolCallRequest`/`encodeToolCallResponse`.

3. **Codex** — codex events arrive as JSON-RPC notifications already close to `BbEvent`. The codex adapter's `translateEvent` receives Zod-validated `CodexNotification` and does minimal mapping. The generic type is `CodexNotification`.

4. **Where does `translateEvent` run?** — in the env-daemon process. The bridge forwards raw events as JSON, the env-daemon calls `adapter.translateEvent(parsedJson)` to get `BbEvent[]`, then forwards those to the server. The SDK types are available in the dependency tree (via `@bb/provider-adapters`).
