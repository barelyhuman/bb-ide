# Phase 7 Manual Pass Log

Date: 2026-03-31
Operator: Codex
Standalone workflow: `scripts/qa/start-standalone.mjs` / `scripts/qa/stop-standalone.mjs`

## Smoke

Status: passed
Provider: codex
Standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-KCEHSM/standalone-state.json`
Smoke thread: `thr_64rn6hwxmq`
Worktree thread: `thr_gzwk4z34g5`
Worktree environment: `env_777cv7gt96`

Validated:

- Unmanaged thread reached `idle`, produced output, and accepted a follow-up.
- Managed worktree thread reached `idle` and exposed `isWorktree: true`.
- Archive blocked a follow-up; unarchive restored normal operation.

## Multi-Thread And Shared Environment

Status: passed
Providers: codex, claude-code, pi
Shared/mixed standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-JRAHy4/standalone-state.json`
Thread A: `thr_py978vchmv`
Thread A environment: `env_p64gtcfzza`
Thread B: `thr_uct3zhqeeg`
Thread B environment: `env_p64gtcfzza`
Claude thread: `thr_chrzvw2f3y`
Claude environment: `env_j4j8epwn88`
Pi thread: `thr_q4nwi2d8eg`
Pi environment: `env_deju88f66y`
Promote/demote standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-2OS7hG/standalone-state.json`
Promote thread: `thr_62ggqkd8m9`
Promote environment: `env_z2qj5c5ph9`

Validated:

- Thread A and B implicitly reused the same ready direct-workspace environment.
- Interleaved follow-ups stayed distinct and the shared direct workspace remained clean.
- Archiving one sibling did not break the other.
- Mixed-provider threads completed in separate worktree environments with no observed cross-thread event contamination.
- `bb environment commit`, `bb environment promote`, and `bb environment demote` all succeeded on the managed worktree in a targeted standalone rerun after correcting stale runbook CLI flags.

## Recovery

Status: passed
Provider: codex
Standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-Fzu9HX/standalone-state.json`
Recovery thread: `thr_5jjummpvqs`
Interrupted status before daemon restart: `active`
Final thread status after recovery: `idle`

Validated:

- The server stayed reachable through both daemon restarts.
- The thread remained inspectable after daemon loss.
- After the mid-turn interruption, the thread resumed from `active` and settled back to `idle` after the daemon reconnected.

## Provider-Specific Pass

Status: passed
Providers: codex, claude-code, pi
Codex standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-QHm0lQ/standalone-state.json`
Codex chat thread: `thr_3gsp5q8bfz`
Codex worktree thread: `thr_pdb9uajj27`
Codex worktree environment: `env_evfc882ykv`
Claude standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-ztAykg/standalone-state.json`
Claude chat thread: `thr_sn97d2xewc`
Claude worktree thread: `thr_agwv5sin9z`
Claude worktree environment: `env_dfka8fuzri`
Pi standalone state path: `/var/folders/lr/f3ynv4xj6p77kvx_rz7zgzg00000gn/T/bb-standalone-MSIqLC/standalone-state.json`
Pi chat thread: `thr_u9kpnvbk7s`
Pi worktree thread: `thr_6dw9zf8s92`
Pi worktree environment: `env_sa65cajbhh`

Validated:

- Each provider completed a single-turn hello, uppercase follow-up, active-turn stop, and worktree file-creation flow on a fresh standalone run.
- The provider-specific worktree runs exposed readable environment status and produced `hello.txt` with `hello world` where the workspace path was available.

## Notes

- The QA runbook was updated to match the current CLI surface: explicit `--model` flags on `bb thread spawn`, `bb thread show` without the removed `--recent-events` flag, and `bb environment commit/promote/demote` with `--thread`.
- The shared direct-workspace prompts explicitly said not to modify files so the archive check exercised lifecycle behavior instead of workspace dirtiness.
- One combined provider-specific loop hit a transient Pi stop timeout after earlier provider work; isolated per-provider reruns passed, so no reproducible product bug remained in that path.
