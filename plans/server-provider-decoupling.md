# Server ↔ Provider Adapter Decoupling

## Status: Mostly complete

Done:
- ProviderSessionController takes ProviderInfo instead of ProviderAdapter
- handleNotification reads env-daemon event envelope directly
- Orchestrator caches ProviderInfo, not adapters
- deriveThreadTitleFromInput and outputFromThreadEvent in @bb/core
- Types canonical in @bb/core, no re-exports
- Scrapped @bb/provider-contracts — types live in @bb/core

## Remaining TODOs

1. **Add `provider.preflight` env-daemon command** — server still calls `preflightSessionStart` through adapter in orchestrator constructor. Should go through env-daemon.
2. **Add `supportsSteer` to `ProviderCapabilities`** — currently the env-daemon resolves steer vs start, but the server has no way to know upfront if steer is supported for UI hints.
3. **Fix `ServerDeps.provider`** — currently typed as `any` for e2e test injection. E2e tests should inject fake providers through the env-daemon test harness instead.
4. **Remove server runtime imports from `@bb/provider-adapters`** — server still imports `createProviderAdapter` (for listModels fallback), `ProviderToolHost`, and LLM completion services. These should either go through env-daemon or move to their own packages.
