# Provider-Neutral Approval Context Plan

## Goal

Fix approval context loss without reintroducing provider-coupled payloads.

The provider-neutral contract should distinguish:

- the action being approved: command, file change, or permission grant.
- the context needed to understand that action's scope and risk.
- the provider response codec that maps the semantic decision back to Codex, Claude Code, or another provider.

This plan covers the immediate regression around dropped Codex approval fields and the related Claude Code mapping gap.

## Provider Facts

### Codex

Codex has native approval methods:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`

Codex command approvals can include:

- `commandActions`: best-effort parsed action details for display.
- `additionalPermissions`: extra execution permissions requested for this command.

Codex file-change approvals can include:

- `grantRoot`: unstable write-root context for the file-change request.

Codex permission approvals return an explicit permission profile and scope through `item/permissions/requestApproval`.

Implication: `additionalPermissions` and `grantRoot` should not be renamed into Codex-specific fields in the domain, but they also must not be dropped. They should map into provider-neutral approval context on the semantic action subject.

### Claude Code

Claude Code in our adapter exposes one interactive request method:

- `item/permissions/requestApproval`

That request is produced from Claude SDK `canUseTool` context:

- `toolName`
- `input`
- `blockedPath`
- `decisionReason`
- `suggestions`

The adapter currently infers a semantic subject:

- `Bash` -> command approval
- `Edit`, `Write`, `NotebookEdit` -> file-change approval
- other tools -> permission grant

The bridge derives a provider-neutral permission profile from `blockedPath`, `suggestions`, and `toolName`, but when the adapter classifies the request as command or file-change, that permission profile is not retained on the subject.

Implication: Claude Code has a related provider-neutral context gap even though it does not use Codex fields such as `additionalPermissions` or `grantRoot`.

## Contract Shape

Add provider-neutral context fields to approval subjects.

### Command Subject

Extend `PendingInteractionCommandApprovalSubject` with:

- `actions`: `PendingInteractionCommandAction[]`
- `executionScope`: `PendingInteractionGrantablePermissionProfile | null`

Meaning:

- `actions` describes what the command is expected to do.
- `executionScope` describes extra network/file-system scope requested for this command execution.
- It does not mean reusable permissions were granted.

### File-Change Subject

Extend `PendingInteractionFileChangeApprovalSubject` with:

- `writeScope`: `{ root: string } | null`
- `executionScope`: `PendingInteractionGrantablePermissionProfile | null`

Meaning:

- `writeScope` is a concise write-root context when the provider has one.
- `executionScope` captures provider-neutral read/write scope context for this one file-change approval.
- Neither field pretends to contain a diff.

### Permission-Grant Subject

Keep `PendingInteractionPermissionGrantApprovalSubject` as the only approval subject that asks the client to grant reusable permissions:

- `permissions`
- `toolName`

Meaning:

- The user is granting a permission profile for a turn/session.
- Resolutions for this subject must include `grantedPermissions` when allowed.

## Non-Goals

- Do not add Codex-specific `additionalPermissions` or `grantRoot` field names to domain/server/app contracts.
- Do not split one provider request into multiple semantic pending interactions in this change.
- Do not invent file diffs or file-change paths when the provider did not provide them.
- Do not support every provider-specific decision type. Keep the public decision subset: `allow_once`, `allow_for_session`, `deny`.

## Implementation Steps

### Phase 1: Domain Contract

Update `packages/domain/src/pending-interactions.ts`:

- Add `actions` and `executionScope` to command approval subjects.
- Add `writeScope` and `executionScope` to file-change approval subjects.
- Define shared named schemas/types for these fields.
- Keep all fields required with nullable where absence is meaningful.

Update all fixture builders and tests that construct command/file-change subjects.

### Phase 2: Codex Adapter Mapping

Update `packages/agent-runtime/src/codex/interactive-requests.ts`:

- Map Codex `commandActions ?? []` to command subject `actions`.
- Map Codex `additionalPermissions` to command subject `executionScope` using the existing grantable permission mapper.
- Map Codex `grantRoot` to file-change subject `writeScope`.
- Set file-change `executionScope` to a provider-neutral file-system write scope if the provider contract makes that safe; otherwise set it to `null` and preserve only `writeScope`.

Update Codex adapter tests:

- Command approval preserves command actions.
- Command approval preserves extra execution scope.
- Command approval filters unsupported macOS permissions from execution scope.
- File-change approval preserves write root.
- Permission request still maps to `permission_grant`.

### Phase 3: Claude Adapter Mapping

Update `packages/agent-runtime/src/claude-code/adapter.ts` and `interactive-contract.ts`:

- For `Bash`, map derived `permissions` to command subject `executionScope`.
- For concrete file-change tools, map derived `permissions` to file-change subject `executionScope`.
- For concrete file-change tools, preserve parseable target path/diff only through existing file-change item events unless the domain subject gets a dedicated target path field.
- Keep fallback tools mapped to `permission_grant` with `permissions`.

Update Claude tests:

- Bash permission approval maps to command subject with execution scope.
- Edit/Write permission approval maps to file-change subject with execution scope.
- WebFetch still maps to permission grant.
- `allow_once` for command/file-change still returns Claude `behavior: "allow"` with no `updatedPermissions`.
- `allow_for_session` for permission grant still returns Claude session updates.

### Phase 4: Resolution Validation

Update server validation only if needed:

- Command/file-change approvals may have execution context but should not accept `grantedPermissions`.
- Permission-grant approvals must include granted permissions when allowed.
- Deny remains valid for all approval subjects.

Add server tests to prove:

- A command approval with `executionScope` cannot be resolved with `grantedPermissions`.
- A file-change approval with `writeScope` cannot be resolved with `grantedPermissions`.
- A permission grant still requires explicit granted permissions.

### Phase 5: Presentation

Update shared pending-interaction presentation:

- Command approvals display command, cwd, actions, and execution scope.
- File-change approvals display write scope/execution scope when present.
- Permission-grant approvals display requested permissions as grantable permissions.

Update app and CLI call sites to use the shared presentation so permissions are not silently hidden.

This phase should dovetail with `plans/approval-timeline-parity.md`, but it should not depend on timeline row rendering changes.

## Validation

Run:

```bash
pnpm exec turbo run typecheck --filter=@bb/domain --filter=@bb/agent-runtime --filter=@bb/server --filter=@bb/core-ui --filter=@bb/app --filter=@bb/cli
pnpm exec turbo run test --filter=@bb/domain
pnpm exec turbo run test --filter=@bb/agent-runtime -- --run src/codex/adapter.test.ts src/claude-code/adapter.test.ts
pnpm exec turbo run test --filter=@bb/server -- --run test/services/pending-interactions.test.ts test/public/public-thread-interactions.test.ts
pnpm exec turbo run test --filter=@bb/core-ui -- --run test/pending-interaction-presentation.test.ts test/pending-interaction-formatting.test.ts
pnpm exec turbo run test --filter=@bb/cli -- --run src/commands/thread
```

Then run the runtime integration suite:

```bash
pnpm exec turbo run test:integration --filter=@bb/agent-runtime
```

## Done Criteria

- Codex `commandActions` are preserved in semantic command approvals.
- Codex `additionalPermissions` are preserved as provider-neutral command execution scope.
- Codex `grantRoot` is preserved as provider-neutral file-change write scope.
- Claude Bash approvals preserve derived execution scope on command subjects.
- Claude Edit/Write approvals preserve derived execution scope on file-change subjects.
- True permission grants remain distinct from command/file-change approvals.
- Server/app/CLI/domain contracts do not expose Codex or Claude field names.
- UI and CLI do not silently approve hidden execution scope.
- Tests cover both Codex and Claude adapter mappings plus server resolution validation.
