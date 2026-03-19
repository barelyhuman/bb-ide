# QA Coverage Audit

This document tracks what the new QA structure already covers well and where the depth is still thin.

## Current Strengths

### Server / E2E smoke

Already covered by checked-in automation:

- standalone CLI roundtrip
- blocked restart
- immediate follow-ups
- worktree follow-up
- shared environment roundtrip
- dynamic tools roundtrip

Representative files:

- `apps/server/src/__tests__/e2e/standalone-server-cli-roundtrip.test.ts`
- `apps/server/src/__tests__/e2e/standalone-server-blocked-restart.test.ts`
- `apps/server/src/__tests__/e2e/thread-immediate-followups-roundtrip.test.ts`

### Env-daemon recovery

Already covered by checked-in automation:

- reconnect after restart
- restart recovery matrix
- recovery-heavy runbook scenarios
- provisioning responsiveness
- concurrent multi-thread stress

Representative files:

- `apps/server/src/__tests__/e2e/environment-daemon-restart-roundtrip.test.ts`
- `apps/server/src/__tests__/e2e/thread-restart-recovery-matrix.test.ts`
- `apps/server/src/__tests__/e2e/thread-recovery-heavy-runbook.test.ts`
- `apps/server/src/__tests__/e2e/thread-multi-thread-stress.test.ts`

### Environments

Already covered by checked-in automation:

- worktree follow-up
- primary checkout behavior
- shared environment sibling behavior

Representative files:

- `apps/server/src/__tests__/e2e/thread-worktree-followup-roundtrip.test.ts`
- `apps/server/src/__tests__/e2e/thread-worktree-primary-checkout-roundtrip.test.ts`
- `apps/server/src/__tests__/e2e/thread-shared-environment-roundtrip.test.ts`

### Providers

Already covered well enough for a baseline:

- provider smoke through shared/provider-specific smoke aliases
- dynamic tool roundtrip for real-provider paths

Representative files:

- `apps/server/src/__tests__/e2e/dynamic-tools-server-roundtrip.test.ts`
- `apps/server/src/__tests__/e2e/codex-dynamic-tools-server-roundtrip.test.ts`

## Current Gaps

### Provider depth is still too implicit

What is weak today:

- the shared provider matrix is documented, but most automated coverage is still embedded in server/e2e naming
- provider-specific overlays exist, but they do not yet contain explicit provider-only regressions or exclusions beyond setup notes
- multi-turn, context-preservation, and system-instruction checks are not yet called out as clearly named automated slices

Recommended next depth increase:

- add provider-focused automation entrypoints that map directly to the shared provider matrix
- add short provider overlay docs for known exclusions or provider-specific regressions as they appear

### CLI depth is still mostly embedded in standalone flows

What is weak today:

- CLI coverage exists, but it is mostly mixed into standalone server flows
- there is not yet a dedicated CLI smoke/core automation entrypoint

Recommended next depth increase:

- define a CLI-focused pass around inspection surfaces and control-plane commands
- add a small scripted CLI-only smoke slice if the current e2e harness supports it cheaply

### Regression depth is only partly normalized

What is weak today:

- owned regression docs now exist for `server` and `env-daemon`, but they are still seed catalogs rather than a full curated regression history
- some older regression knowledge still only exists implicitly in e2e scenario files or the legacy standalone matrix

Recommended next depth increase:

- add concrete regression entries to the owned docs as fixes land
- lift high-value regression repros out of e2e scenario files into the owned regression catalogs when they become stable operator checks

### Product QA is still detailed but not yet normalized

What is weak today:

- manager QA has strong scenario detail, but it still exists as two large product docs rather than a smaller shared structure with clear smoke/core/deeper layers

Recommended next depth increase:

- consolidate manager QA into a shared `product/core` checklist plus scenario appendices only where needed

## Recommended Priority Order

1. Provider depth and explicit provider automation naming
2. CLI-focused smoke/core pass
3. Split legacy lifecycle invariants into owned server and env-daemon references
4. Normalize product QA structure
