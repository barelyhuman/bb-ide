# `provider.list` -- List Available Providers (Host-Daemon Command)

**Schema:** `packages/host-daemon-contract/src/commands.ts:126`
**Handler:** `apps/host-daemon/src/command-dispatch.ts:95` (inline in dispatch switch)
**Result Schema:** `packages/host-daemon-contract/src/commands.ts:303`
**Workspace Lane:** No

## Command Payload

| Field | Required | Notes |
|---|---|---|
| `type` | Yes | Literal `"provider.list"`. Discriminant only. |

**All 1 field consumed. No dead params.**

## Implementation Trace

1. `dispatchCommand` matches `"provider.list"` at line 95.
2. Calls `(options.listProviders ?? defaultListProviders)()` -- synchronous, no await.
3. `defaultListProviders` (command-dispatch-support.ts:86) delegates to `listAvailableProviders` re-exported from `@bb/agent-runtime`.
   - This is `listAvailableProviderInfos` from `packages/agent-runtime/src/provider-registry.ts:50`.
   - Iterates `builtInFactories` (codex, claude-code, pi), instantiates each adapter, collects `{ id, displayName, capabilities, available: true }`.
   - `capabilities` is `{ supportsRename, supportsServiceTier }` per `providerCapabilitiesSchema`.
4. Returns `{ providers: ProviderInfo[] }`.

Result shape: `{ providers: Array<{ id, displayName, capabilities: { supportsRename, supportsServiceTier }, available }> }`.

## Code Reuse

- `defaultListProviders` in command-dispatch-support.ts is a thin wrapper around the agent-runtime registry.
- `listProviders` is injectable via `CommandDispatchOptions` for testing.

## Flags

1. `available` is hardcoded to `true` for every provider. There is no credential check or reachability probe -- the field is structurally meaningless today. If the intent is to report whether the provider is actually usable (e.g., API key present), this needs implementation. If not, consider removing the field.

## Usages

| Caller | Location | Trigger |
|---|---|---|
| `GET /system/providers` | `apps/server/src/routes/system.ts:43` | Client requests available providers. Calls `queueCommandAndWait` with `{ type: "provider.list" }`. |
| `GET /system/models` (no `providerId`) | `apps/server/src/routes/system.ts:70` | Client requests all models without specifying a provider. First lists providers via `queueCommandAndWait` with `{ type: "provider.list" }`, then iterates to fetch models per provider. |

---

## Review Comments

<!-- Leave comments, questions, or follow-ups below. Delete this file if no action needed. -->
