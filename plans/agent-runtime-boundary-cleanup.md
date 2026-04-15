# Agent Runtime Boundary Cleanup

## Diagnosis

`@bb/agent-runtime` sits between the server/host-daemon and three provider SDKs (Claude Code, Codex, PI), unifying their event models into a single `ThreadEvent` stream. The behavior is correct — a recent branch (`codex/fix-thread-event-order`) resolved real race bugs around event ordering, stop handling, and synthetic user-message acks. But each fix was layered on top of the previous code, and the resulting shape has drifted.

Four real issues at the package boundaries:

1. **JSON-RPC transport leaks through the adapter contract.** `ProviderAdapter.buildCommand` returns `JsonRpcMessage | null`. `JsonValue` is exported for `buildInteractiveResponse`. Every adapter has to know JSON-RPC wire shape. That's a transport concern; adapters should speak in high-level intents and let the runtime serialize. The `| null` return also encodes "this command isn't supported in this state" — a capability issue masquerading as a return type.

2. **`translateEvent(event: unknown, ...)` erases provider-side types.** AGENTS.md forbids `unknown` outside truly freeform boundaries. Each provider SDK has a typed event envelope; passing it through as `unknown` forces each adapter to re-parse events it already knows the shape of.

3. **The public `AgentRuntime` interface leaks SDK-specific and product-policy details.**
   - `resumeThread({ resumePath })` is a Claude Code filesystem path — SDK-specific data on a generic interface.
   - `providerId?` is optional on start/resume — default-provider selection is server-side product policy, not a runtime concern.
   - `adapterFactory` test hook sits in production `AgentRuntimeOptions`.
   - `export type ProviderInfo = DomainProviderInfo` is a re-export, explicitly forbidden by AGENTS.md §Reuse.
   - `AgentRuntimeExecutionOptions` and `AdapterOptions` overlap significantly; the translation layer between them is unclear.

4. **Residue in `runtime.ts` from the ack refactor.** `activeTurnIdByThreadId` and `completedTurnIdsByThreadId` were originally there to coordinate synthetic user-message ack emission. After `42e4b6bd` moved ack handling into the adapters, these maps remain. Their current uses (steer validation, stop command payload, replay dedup at the event handler) are legitimate but narrower than what they were designed for. The replay-dedup case in particular arguably belongs at the transport/reconnect layer, not the runtime event handler.

A prior draft of this plan also flagged runtime-shaped types living in `@bb/domain` (`RuntimePermissionPolicy`, `ServiceTier`, `ReasoningLevel`). **That was wrong** — those types are consumed by ≥2 packages (server, runtime, UI) and belong in domain by the shared-vocabulary rule. Don't relocate them.

## Phase 1: Remove transport leaks from the adapter contract

**Goal:** Adapter contract describes intent; runtime handles serialization.

**Changes:**
- In `provider-adapter.ts`:
  - Change `buildCommand` to return a high-level result type (`{ method: string; params: unknown } | CommandUnsupported`) instead of `JsonRpcMessage | null`. The runtime wraps into JSON-RPC.
  - Express "command not supported in this state" as an explicit `CommandUnsupported` variant instead of `null`.
  - Remove `JsonValue` from the adapter contract surface. Move it to runtime internals.
- In `translateEvent`, replace the `unknown` event parameter with the typed envelope each adapter's bridge produces. Each adapter declares its own event type.
- Drop `threadStopBehavior: "keep-provider" | "restart-provider"` enum from the adapter interface. Let each adapter's `buildCommand("thread/stop")` return the right command (restart-provider adapters return a teardown-style command; keep-provider adapters return an interrupt). The enum leaks provider-specific policy as a capability flag.

**Exit criteria:**
- `ProviderAdapter.buildCommand` no longer returns `JsonRpcMessage` directly.
- No adapter declares `threadStopBehavior`.
- `JsonValue` is not exported from the adapter contract.
- `translateEvent` takes a typed parameter, not `unknown`.
- `pnpm exec turbo run typecheck --filter=@bb/agent-runtime` passes.

## Phase 2: Tighten the public `AgentRuntime` interface

**Goal:** Public contract describes what the runtime does, not SDK or test details.

**Changes:**
- Remove `resumePath?` from `resumeThread`. If Claude Code genuinely needs to know a filesystem path for session resumption, encode that in the adapter's own state — pass it through `providerThreadId` or an adapter-specific resumption mechanism, not on the generic interface.
- Make `providerId` required on `startThread` and `resumeThread`. Default-provider selection is the server's job; if there's a fallback today, move it to the server route that calls the runtime.
- Remove `adapterFactory` from `AgentRuntimeOptions`. Either:
  - (a) Split into `AgentRuntimeOptions` (production) and `AgentRuntimeTestOptions` (adds `adapterFactory`), exposed from a separate test entry point (`@bb/agent-runtime/test`).
  - (b) Provide a dedicated `createAgentRuntimeForTests(options)` factory with the hook.
  Prefer (a).
- Remove the `ProviderInfo` re-export in `types.ts:18`. Update consumers to import `ProviderInfo` from `@bb/domain` directly.
- Reconcile `AgentRuntimeExecutionOptions` (`types.ts`) with `AdapterOptions` (`provider-adapter.ts`). Either:
  - Use the same type.
  - Or make the transformation explicit (e.g., `toAdapterOptions(runtimeOptions, { instructions, envVars })`) and name it so the difference is obvious.

**Exit criteria:**
- `resumePath` no longer appears on the generic `resumeThread` signature.
- `providerId` required on start/resume.
- `adapterFactory` not reachable via the production-entry import of the package.
- No re-export of `ProviderInfo`.
- Option types reconciled (or explicit translation documented).
- `pnpm exec turbo run typecheck` passes across all packages that import from agent-runtime.

## Phase 3: Clean up runtime state residue

**Goal:** State that exists in `runtime.ts` because of a prior refactor is either earning its keep or moves out.

**Changes:**
- Audit each use of `activeTurnIdByThreadId` and `completedTurnIdsByThreadId`:
  - Steer validation (`steerTurn` active-turn check) — adapter already tracks turn state via its own SDK callbacks. Consider pushing this validation into the adapter's `buildCommand("turn/steer", ...)` path and dropping the runtime-side map.
  - Stop command payload (pass `activeTurnId` with the stop command) — same consideration: the adapter can resolve this at command-build time.
  - Replay dedup at the event handler (line ~393 in `runtime.ts`: "skip active turn update for replayed turn/started on already completed turn") — this is a transport concern. Reconnect handling should dedupe events before they reach the runtime's event handler, not after. If the daemon can't reliably dedupe, document why.
- If any of these maps survive the audit, document what they're for in a comment at their definition so the next refactor doesn't have to re-derive it.

**Exit criteria:**
- Either the maps are gone, or their remaining uses are documented with a 2–3 line comment explaining *why they're in the runtime* and not in the adapter or transport layer.
- `pnpm exec turbo run test --filter=@bb/agent-runtime` passes.

## Out of scope — considered and declined

- **Relocating `RuntimePermissionPolicy`, `ServiceTier`, `ReasoningLevel` out of `@bb/domain`.** These are genuinely shared across ≥2 packages. A prior draft proposed moving them; that was wrong.
- **Splitting `runtime.ts` further.** At 965 lines it's large but coherent. If Phase 3 reduces it, fine. Don't split for split's sake.
- **Unifying `startThread` and `resumeThread` into one method.** They're genuinely different operations with different inputs. Separate signatures are correct.
- **Making `capture-types.ts` exports internal.** The capture system is used by the audit package; removing the exports would break that consumer. Addressed in the agent-provider-audit plan, not here.
- **`onInteractiveRequest?` optional.** Leave it alone until a concrete case motivates it.
- **Duplicate server-side and daemon-side active-turn guards.** Addressed in the server-stack cleanup plan.
- **The remaining user-message signature dedup** (`userMessageSignature` in `user-message-dedup.ts`). That's a UI-stack concern — covered in the UI-stack cleanup plan.

## Expected impact

Phase 1 is the highest-value structural change — it repositions the adapter contract so future providers don't have to know JSON-RPC. Phase 2 is mechanical cleanup of the public interface. Phase 3 may reduce to "add a comment explaining why this state is here" if the maps genuinely earn their keep after audit.

Three PRs. Phases are independent except Phase 3's findings may affect Phase 1 decisions (e.g., if the stop command payload no longer needs `activeTurnId` from the runtime side, Phase 1's stop command shape changes).
