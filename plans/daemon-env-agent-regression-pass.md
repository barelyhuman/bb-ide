# Goal

Stabilize the daemon `<->` environment-agent integration after the March 11, 2026 session recovery and self-suspend changes, starting with the regressions most likely to explain immediate app breakage.

# Scope

- Confirm and fix the env-agent self-suspend regression that can shut down an agent shortly after non-turn traffic such as `provider.ensure`, `workspace.status`, or thread rename commands.
- Confirm and fix healthy-session heartbeat spam caused by tying heartbeats to the 250ms supervisor poll loop instead of the negotiated heartbeat interval.
- Audit daemon-side recovery when a runtime exists but the daemon no longer has an active session, especially the new suspend-and-recover path.
- Audit in-flight command recovery when a session disappears after a command has already been acknowledged or started.
- Confirm and fix stale provider-thread reuse after environment-agent session close/expiry/replacement so new tells do not skip `thread.resume` against dead provider state.
- Confirm and fix `tell()` pre-start failures that can leave Beanbag threads stuck in `active` when `turn.start` never actually begins.
- Add focused tests for the above paths and rerun the relevant daemon/environment-agent suites.
- Leave unrelated UI-only issues out of scope unless they are directly caused by these daemon/environment-agent failures.

# Implementation Steps

1. Add a regression test in `packages/environment-agent/src/session-supervisor.test.ts` that proves non-turn commands do not trigger self-suspend by themselves.
2. Add focused session-supervisor coverage that asserts healthy sessions do not send heartbeats on every 250ms poll tick and that command polling behavior is explicit in tests.
3. Decouple heartbeat cadence from the fast supervisor loop so healthy sessions honor the negotiated heartbeat interval instead of heartbeating on every cycle.
4. Decide whether to implement real blocking long-poll for `/session/commands` or keep short polling with a much slower/adaptive idle cadence, then add coverage for the chosen behavior.
5. Fix env-agent quiescence eligibility so self-suspend requires an explicit idle transition, not merely `turnState !== "active"`.
6. Add a targeted daemon/environment recovery test around the `_ensureEnvironmentAgentAccess()` path where a runtime exists but there is no active session.
7. Decide and implement one recovery strategy for that path:
   await teardown before reprovisioning, or avoid teardown when the existing managed agent can safely reconnect.
8. Add coverage for session-loss recovery of commands already in `received` or `started` state, then adjust dispatcher behavior so they do not hang until timeout on a dead session.
9. Add coverage for stale provider-thread invalidation on env-agent session close/replacement and for `tell()` rollback when `turn.start` fails before any `turn/started` event arrives.
10. Ensure missing-provider-thread detection also catches provider RPC `thread not found` failures so recovery takes the resume/reprovision path instead of retrying the same dead thread id.
11. Run the focused daemon/environment-agent unit tests plus the existing restart/follow-up e2e coverage to verify the fixes under realistic recovery flows.

# Validation

- `pnpm exec vitest run packages/environment-agent/src/session-supervisor.test.ts`
- `pnpm exec vitest run packages/environment-agent/src/session-sync.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/environment-agent-session-command-client.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/environment-agent-session-service.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/environment-agent-session-orchestrator-roundtrip.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/orchestrator.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/e2e/environment-agent-restart-roundtrip.test.ts`
- `pnpm exec vitest run apps/daemon/src/__tests__/e2e/thread-worktree-followup-roundtrip.test.ts`
- Manual check: open the app, idle on a thread for more than 5 seconds, then send a follow-up and confirm no immediate inactive-session or provider-unavailable failures.
- Manual check: confirm a healthy idle session no longer emits `POST /session/heartbeat` and `GET /session/commands` roughly four times per second.

# Open Questions/Risks

- High confidence: the self-suspend logic is currently too permissive and can treat non-turn traffic as enough “observed work” to shut the agent down about one second later.
- High confidence: healthy env-agent sessions currently spam the daemon because `sendHeartbeat()` and `pullCommands()` are both executed on every 250ms supervisor cycle even though the daemon advertises a 10s heartbeat interval.
- Likely: the daemon recovery path now detaches and asynchronously suspends the current runtime before reprovisioning, which can race with managed-agent restart and leave the daemon pointed at an agent that is about to die.
- Likely: command recovery is still incomplete for commands already marked `received` or `started`; those commands can remain stranded on the dead session and surface as timeouts instead of clean recovery.
- Confirmed regression: daemon provider-thread cache can outlive the env-agent session that proved it, which lets later tells skip `thread.resume` and send `turn.start` to dead provider thread ids unless invalidation is wired through session close/expiry/replacement.
- Confirmed regression: `_tell()` currently marks threads `active` before the turn-start RPC succeeds; without explicit rollback, provider-side start failures can leave the backend and UI stuck in stale active state.
- Open design choice: if `/session/commands` remains non-blocking, the transport should stop calling itself `http-long-poll` or adopt an adaptive pull strategy that matches the protocol contract.
- The worktree is currently dirty in `apps/daemon/src/orchestrator.ts` and `apps/daemon/src/__tests__/orchestrator.test.ts`; any implementation work needs to preserve those local changes.
