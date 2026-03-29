# `provider.list_models` -- List Models for a Provider (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:130`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:99` (inline in dispatch switch)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:306`
**Workspace Lane:** No

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"provider.list_models"`. Discriminant only. |
| `providerId` | Yes | `z.string().min(1)`. Passed to `listModels(providerId)` to select which provider adapter to query. |

**All 2 fields consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"provider.list_models"` at line 99.
2. Calls `await (options.listModels ?? defaultListModels)(command.providerId)`.
3. `defaultListModels` (command-dispatch-support.ts:90) calls `createProviderForId(providerId).listModels()`.
   - `createProviderForId` looks up the provider in `builtInFactories` (codex, claude-code, pi).
   - If `providerId` is not found, throws `Error("Unsupported provider ...")` which will surface as `errorCode: "command_failed"`.
   - `.listModels()` is async, returns `AvailableModel[]`.
4. Returns `{ models: AvailableModel[] }`.

Result shape: `{ models: Array<{ id, model, displayName, description, supportedReasoningEfforts, defaultReasoningEffort, isDefault }> }`.

## Code Reuse

- `defaultListModels` in command-dispatch-support.ts wraps the agent-runtime registry.
- `listModels` is injectable via `CommandDispatchOptions` for testing.
- `createProviderForId` is shared with thread start/resume flows (provider adapter creation).

## Flags

1. Invalid `providerId` throws a generic `Error`, not a `CommandDispatchError`. The error code will be `"command_failed"` instead of a specific code like `"unknown_provider"`. Consider wrapping with `CommandDispatchError("unknown_provider", ...)` for a better error contract.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `GET /system/models` (with `providerId`) | `apps/server/src/routes/system.ts:56` | Client requests models for a specific provider. Calls `queueCommandAndWait` with `{ type: "provider.list_models", providerId }`. |
| `GET /system/models` (no `providerId`) | `apps/server/src/routes/system.ts:78` | Client requests all models. After listing providers, calls `queueCommandAndWait` with `{ type: "provider.list_models", providerId }` for each provider in a `Promise.all`. |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
