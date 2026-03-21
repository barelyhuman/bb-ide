# @bb/provider-adapters

Provider adapter layer for bb. The single translation layer between bb and each provider (Codex, Claude Code, Pi, and future extensions).

## Architecture

```
bb server  <->  env-daemon  <->  bridge process  <->  provider SDK
                    |                                    (codex app-server /
                    |                                     claude agent SDK /
                    |                                     pi coding agent)
                    v
            adapter.translateEvent()    <-- raw SDK events
            adapter.buildCommand()      --> typed provider commands
```

Each adapter owns both translation directions:

- **Outbound**: bb `ProviderRequest` -> provider-specific command via `buildCommand()`
- **Inbound**: raw SDK events -> `BbProviderEvent[]` via `translateEvent()`

Bridge processes are thin JSON-RPC shells that manage SDK session lifecycle and forward raw events. They do not translate events.

## The `ProviderAdapter` contract

```typescript
interface ProviderAdapter<TProviderEvent, TProviderCommand> {
  // Identity & launch
  id: string;
  displayName: string;
  capabilities: ProviderCapabilities;
  process: { command: string; args: string[] };
  resolveLaunchConfiguration?(context): ProviderLaunchConfiguration | Promise<...>;
  preflightSessionStart?(): string | undefined | Promise<...>;

  // Outbound: bb request -> provider command
  buildCommand(request: ProviderRequest): TProviderCommand | null;

  // Inbound: provider event -> bb events
  translateEvent(event: TProviderEvent): BbProviderEvent[];

  // Tool call codec
  decodeToolCallRequest(args): ProviderToolCallRequest | null;
  encodeToolCallResponse(response): ProviderToolCallResponse;

  // Provider capabilities
  listModels(): Promise<AvailableModel[]>;
}
```

Generic type parameters force each adapter to declare its SDK types:

- **Codex**: `ProviderAdapter<CodexEvent, CodexCommand>` — `CodexEvent` is the generated `ServerNotification` from the codex app-server protocol
- **Claude Code**: `ProviderAdapter<ClaudeCodeEvent, ClaudeCodeCommand>` — `ClaudeCodeEvent` is `SDKMessage` from the Claude Agent SDK
- **Pi**: `ProviderAdapter<PiEvent, PiCommand>` — `PiEvent` is `AgentSessionEvent` from the Pi coding agent

## `BbProviderEvent` — the canonical event type

A closed, discriminated union of every event bb understands. ~25 event types covering turn/thread lifecycle, items (agent messages, command execution, file changes, web search, tool calls, reasoning, plans), streaming deltas, token usage, errors, and warnings.

See `plans/bb-event-design.md` for the full design rationale.

## Bridge processes

Each bridge is a child process that manages the provider SDK session:

- Receives typed commands (validated with Zod schemas)
- Forwards raw SDK events as `{ method: "sdk/message", params: { threadId, message } }`
- Handles tool call forwarding (SDK -> env-daemon -> SDK)
- Emits `thread/identity` and `error` notifications

The bridge does NOT translate events — the adapter's `translateEvent` does that.

## Testing

```bash
# Unit tests (106 tests, no external dependencies)
pnpm test

# Integration tests (24 tests, requires provider auth)
# Reads .env from project root for CLAUDE_CODE_OAUTH_TOKEN etc.
# Codex: OPENAI_API_KEY or ~/.codex/auth.json
# Claude Code: ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN
# Pi: ~/.pi/agent/auth.json
pnpm test:integration
```

## Package exports

- **Contract types** — `ProviderAdapter`, `ProviderRequest`, `BbProviderEvent`, `BbProviderEventItem`, and supporting types
- **Registry** — `registerProvider`, `createProviderAdapter`, `listAvailableProviderInfos`
- **Built-in factories** — `createCodexProviderAdapter`, `createClaudeCodeProviderAdapter`, `createPiProviderAdapter`
- **Tool hosting** — `ProviderToolHost`
- **LLM services** — title generation, commit message generation
