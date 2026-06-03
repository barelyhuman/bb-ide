# Plan: Gate multi-host support behind a feature flag

## Goal

Add a `multiHost` feature flag so the default product surface is **single-host**
(only the local bundled daemon), while preserving full multi-host capability when
the flag is on. Mirror the existing `terminals` / `askUserQuestion` flag plumbing.

## Decisions (recommended defaults — confirm before implementing)

1. **Default state:** `multiHost: false` — dark launch, single-host by default.
2. **Hosts settings section when off:** keep it **read-only** showing the local
   host's status; hide only the "Add another host" button and the per-host
   rename/remove actions. (Alternative: hide the whole section — simpler but less
   friendly.)
3. **CLI depth:** server-enforce as the source of truth; additionally hide the
   `bb host` command group and the `--host` flag by having the CLI read
   `/system/config`. (Minimal alternative: server-enforce only, leave CLI as-is.)
4. **Pre-existing remote hosts when flipped off:** **out of scope.** Assume the
   flag is set before any remote host is joined. Documented as an assumption, not
   handled in v1.

## What "off" means

The system always has exactly one host: the local bundled daemon, which
provisions itself via the join flow with `joinMode: "local"`
(`packages/server-contract/src/host-join-request.ts:22`). "Multi-host off" means:
no **additional/remote** hosts can be registered, and host-selection affordances
are hidden. The single choke point is host **registration**
(`POST /hosts/join`) — block remote joins there and multi-host is effectively off;
all UI/CLI changes are cosmetic (removing dead affordances).

## Implementation

### 1. Flag plumbing (mechanical — mirror `terminals`)

- `packages/domain/src/feature-flags.ts` — add `multiHost: z.boolean()` to
  `featureFlagsSchema` and `defaultFeatureFlags` (value per decision 1).
- `packages/config/src/env-vars.ts` (~line 190, beside `BB_FF_TERMINALS_ENV`) —
  add `BB_FF_MULTI_HOST_ENV` (`defineEnvVar<boolean>`, `parseBooleanEnvValue`) and
  `DEFAULT_BB_FF_MULTI_HOST`.
- `packages/config/src/feature-flags.ts:16` — read `multiHost` in
  `loadFeatureFlags` via `readEnvVarWithDefault`.
- `apps/app/src/lib/system-config-atoms.ts:11` — add `multiHost: false` to
  `unavailableFeatureFlags` (fail closed) and add a `multiHostEnabledAtom`
  mirroring `terminalsEnabledAtom:215`.
- `.env` — document `BB_FF_MULTI_HOST=...` next to the other `BB_FF_*` entries.
- No change to `/system/config` — it already returns `deps.config.featureFlags`
  wholesale (`apps/server/src/routes/system.ts:29`).

### 2. Server enforcement (the load-bearing change)

- `apps/server/src/routes/hosts.ts:69` — in `POST /hosts/join`, when
  `!isLocalHostJoinRequest(payload) && !deps.config.featureFlags.multiHost`,
  throw `new ApiError(403, "multi_host_disabled", ...)`. Local joins still pass.
  This is the real gate.

### 3. Frontend gating (hide dead affordances)

- `apps/app/src/views/AppSettingsView.tsx:566` — gate "Add another host" on
  `multiHostEnabledAtom`; per decision 2 also hide the per-host actions dropdown
  (rename/remove, ~line 524) so the section is read-only when off.
- `apps/app/src/components/promptbox/NewThreadPromptBox.tsx:380` — `HostSlot`
  already returns `null` when `eligibleHosts.length < 2`, so it is already hidden
  in single-host mode. Optionally gate explicitly on the flag for clarity.
- `apps/app/src/components/pickers/EnvironmentPicker.tsx:44` — verify
  `buildHostSections` doesn't render a redundant host grouping/label with a
  single host.
- `apps/app/src/views/RootComposeView.tsx:373` — eligible-host computation already
  yields just the local host when only one exists; confirm no behavior change
  needed.

### 4. CLI gating (per decision 3)

- `apps/cli/src/commands/host.ts` — guard/hide the `bb host` command group when
  the flag is off (CLI reads `/system/config`).
- `apps/cli/src/commands/thread/spawn.ts:155`,
  `apps/cli/src/commands/manager.ts:87` — hide the `--host` flag when off. Server
  already rejects unjoinable hosts, so this is polish, not correctness.

## Out of scope / assumptions

- No migration/handling for a DB that already contains remote hosts when the flag
  is flipped off (decision 4).
- The host-daemon enroll path (`/internal/hosts/enroll`) is unchanged: a remote
  daemon can't enroll without an enroll key, and the join endpoint is the only
  issuer — gating the join is sufficient.

## Test plan

- `@bb/server` — `routes/hosts` test: with `multiHost: false`, `POST /hosts/join`
  returns 403 for a remote join and 201 for `joinMode: "local"`; with
  `multiHost: true`, remote join returns 201. Use in-memory SQLite
  (`createConnection(":memory:")` + `migrate(db)`), never mock the DB.
- `@bb/config` — `loadFeatureFlags` reads `BB_FF_MULTI_HOST` and applies the
  default when unset.
- Client/CLI hiding is presentation — add a test only where it encodes real logic
  (per the repo test-quality bar), not for a JSX conditional.

## Validation

```sh
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/config \
  --filter=@bb/server-contract --filter=@bb/server --filter=@bb/app --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/server --filter=@bb/config > /tmp/mh-test.txt 2>&1
# then read /tmp/mh-test.txt
```

Manual check (single-host, flag off): no "Add another host" button in Settings,
no host picker in the new-thread prompt box, `POST /hosts/join` for a remote join
returns 403, local daemon still connects normally.

## Exit criteria

- [ ] `multiHost` flag exists end to end (domain → config → env → client atom),
      defaulting per decision 1, failing closed when the server is unreachable.
- [ ] `POST /hosts/join` rejects remote joins (403) and allows local joins when
      the flag is off; both allowed when on.
- [ ] With the flag off: no add/select-host affordances in app or CLI; local host
      provisions and connects unchanged.
- [ ] Server + config tests above pass; typecheck clean across the six packages.
- [ ] Delete this plan file once the work lands.
