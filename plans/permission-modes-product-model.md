# Permission Modes Product Model

## Goal

Replace the branch's overloaded `limited` permission mode with a product model that matches how users think about trust:

- `full`: the agent has full provider permissions and should not prompt.
- `workspace-write`: the agent may work normally inside the workspace, including writing workspace files. Anything outside that envelope escalates.
- `readonly`: the agent may read and analyze. Mutations, shell execution, network, and outside-workspace access escalate.

The server owns the policy for what escalation means:

- Direct user sessions escalate by asking the user through pending interactions.
- Managed threads and automations escalate by denying with guidance.

Do not expose provider-native names such as `acceptEdits`, `bypassPermissions`, `on-request`, `on-failure`, `dontAsk`, or `dangerouslySkipPermissions` in product contracts or UI.

## Product Semantics

| Context | Mode | Behavior |
| --- | --- | --- |
| Direct user session | `full` | All provider permissions. No permission prompts expected. |
| Direct user session | `workspace-write` | Work and write inside the workspace. Ask for outside-workspace writes, unsandboxed shell escapes, network/escalated provider permissions, or other out-of-envelope actions. |
| Direct user session | `readonly` | Read/analyze inside the workspace. Ask for writes, shell execution, network, or other out-of-envelope actions. |
| Managed threads / automations | `full` | Same as direct `full`. |
| Managed threads / automations | `workspace-write` | Work and write inside the workspace. Deny outside-workspace writes, unsandboxed shell escapes, network/escalated provider permissions, or other out-of-envelope actions. |
| Managed threads / automations | `readonly` | Read/analyze inside the workspace. Deny writes, shell execution, network, or other out-of-envelope actions. |

## Internal Model

Use two concepts internally:

```ts
permissionMode:
  | "full"
  | "workspace-write"
  | "readonly"

permissionEscalation:
  | "ask"
  | "deny"
```

`permissionMode` is user-visible and persisted.

`permissionEscalation` is server-owned runtime policy. It is derived from execution context and sent through the server/daemon/runtime command boundary. It is not user-configurable.

Initial derivation:

| Execution context | `permissionEscalation` |
| --- | --- |
| Root thread driven by direct user app/CLI turn | `ask` |
| Managed thread | `deny` |
| Automation / scheduled work | `deny` |
| Child/subagent thread where pending interactions are not supported | `deny` |

If a future surface can safely present pending interactions, it may opt into `ask` by changing the server-owned derivation in one place.

## Provider Mapping

### Codex

Codex has native sandbox modes and approval policies.

| BB mode + escalation | Codex mapping |
| --- | --- |
| `full` | `sandbox: "danger-full-access"`, `approvalPolicy: "never"`, `sandboxPolicy: { type: "dangerFullAccess" }` |
| `workspace-write + ask` | `sandbox: "workspace-write"`, `approvalPolicy` that asks/escalates for out-of-sandbox requests, `sandboxPolicy: workspaceWrite` |
| `workspace-write + deny` | `sandbox: "workspace-write"`, deny out-of-envelope approval requests |
| `readonly + ask` | `sandbox: "read-only"`, approval policy asks for writes/commands/escalations |
| `readonly + deny` | `sandbox: "read-only"`, deny approval requests |

Implementation note: choose the Codex approval policy explicitly during implementation. The likely candidates are `on-request`, `on-failure`, or granular approval. The chosen mapping must be backed by adapter tests and one provider smoke case.

### Claude Code

Use Claude Agent SDK permission modes, `canUseTool`, hooks, and sandbox settings.

| BB mode + escalation | Claude mapping |
| --- | --- |
| `full` | `permissionMode: "bypassPermissions"`, `allowDangerouslySkipPermissions: true` |
| `workspace-write + ask` | `permissionMode: "acceptEdits"`, `sandbox.enabled: true`, `sandbox.autoAllowBashIfSandboxed: true`, `sandbox.allowUnsandboxedCommands: true`, `canUseTool` forwards unsandbox/outside requests to pending interactions |
| `workspace-write + deny` | `permissionMode: "acceptEdits"`, `sandbox.enabled: true`, `sandbox.autoAllowBashIfSandboxed: true`, `sandbox.allowUnsandboxedCommands: false`, hooks/canUseTool deny out-of-envelope requests with guidance |
| `readonly + ask` | `permissionMode: "default"`, hooks force `Write`, `Edit`, `MultiEdit`, `NotebookEdit`, `Bash`, `WebFetch`, `WebSearch`, and mutating MCP tools through `canUseTool`; `canUseTool` forwards to pending interactions |
| `readonly + deny` | `permissionMode: "dontAsk"`, deny hooks for mutating/shell/network tools with clear policy context |

Do not use Claude `plan` for bb `readonly`. Provider smoke tests showed `plan` writes provider plan files under `~/.claude/plans` and changes behavior into plan/exit-plan workflow, which is not bb's readonly product semantics.

### Pi

Pi supports only `full` until it has a real permission model. Provider capabilities should expose only `full` for Pi, and the server should reject `workspace-write`/`readonly` for Pi.

## Implementation Phases

### Phase 1: Domain And Contract Shape

- Replace `permissionModeSchema = z.enum(["limited", "full"])` with `["readonly", "workspace-write", "full"]`.
- Add a runtime-only `permissionEscalationSchema = z.enum(["ask", "deny"])` in the appropriate shared contract package.
- Add `permissionEscalation` to resolved execution options that cross the server/daemon/runtime boundary.
- Do not add `permissionEscalation` to create-thread or send-message public request bodies.
- Rename all `limited` identifiers, labels, tests, fixtures, and query/local-storage validation paths.
- Keep `permissionMode` required after server resolution. Fill defaults once at the server boundary.

Exit criteria:

- No `limited` permission mode remains in app, CLI, server, daemon contract, runtime adapters, or tests except migration comments if needed.
- Public API accepts only `readonly`, `workspace-write`, and `full`.
- Runtime command contracts carry explicit `permissionMode` and `permissionEscalation`.

### Phase 2: Server Policy Ownership

- Default direct user sessions to `full` unless product requirements change.
- Derive `permissionEscalation` on the server from execution context.
- Ensure managed threads, automations, and unsupported child-thread contexts derive `deny`.
- Ensure direct user app/CLI turns derive `ask`.
- Provider capability validation must reject unsupported modes before commands reach the daemon.
- Keep product policy out of daemon/provider adapters except translation of explicit server-resolved values.

Exit criteria:

- Server tests cover default mode resolution, project defaults, last-execution inheritance, provider capability rejection, direct `ask`, and managed/automation `deny`.
- Host daemon contract tests assert both `permissionMode` and `permissionEscalation` round-trip.

### Phase 3: Codex Translation

- Map `full`, `workspace-write`, and `readonly` to Codex sandbox policies.
- Map `permissionEscalation` to Codex approval behavior or runtime denial behavior.
- Ensure `workspace-write + ask` surfaces out-of-envelope requests through pending interactions.
- Ensure `workspace-write + deny` and `readonly + deny` return useful denial responses instead of hanging or surfacing unsupported JSON-RPC errors.
- Ensure `readonly + ask` can approve a write or command and return the result.

Exit criteria:

- Codex adapter tests cover all three modes and both escalation values where applicable.
- Integration/provider smoke covers at least direct `workspace-write + ask`, direct `readonly + ask`, and managed `readonly + deny`.

### Phase 4: Claude Translation

- Extend the Claude bridge command schema and `SdkSessionOptions` to carry `permissionEscalation`, hooks, and sandbox options.
- Map `full` to `bypassPermissions`.
- Map `workspace-write` to `acceptEdits` plus Claude sandbox.
- Map `readonly + ask` to `default` plus ask hooks and `canUseTool`.
- Map `readonly + deny` to `dontAsk` plus deny hooks.
- Use policy denial messages that tell Claude what is allowed and how to recover:
  - Workspace Write denial: stay inside the current workspace or explain why extra access is needed.
  - Readonly denial: continue with a read-only answer; do not modify files, run shell commands, use network, or access outside the workspace.
- Do not use `plan` for bb readonly.

Exit criteria:

- Claude bridge unit tests assert SDK options for all mode/escalation combinations.
- Claude adapter tests assert command payloads include the server-resolved policy.
- Real SDK smoke tests cover:
  - `acceptEdits` auto-allows workspace `Write`.
  - `acceptEdits` plus sandbox auto-allows safe workspace Bash.
  - sandbox blocks outside-workspace Bash when unsandboxed commands are disabled.
  - `readonly + ask` routes `Write` and `Bash` through `canUseTool`.
  - `readonly + deny` blocks `Write` and `Bash` with useful context.

### Phase 5: Pending Interaction Lifecycle Alignment

- Pending interactions should represent only permission/escalation requests, not generic provider questions.
- Direct user contexts with `permissionEscalation: "ask"` may register pending interactions.
- `permissionEscalation: "deny"` must not create pending interactions; it returns provider-native denial responses.
- Ensure unsupported thread contexts do not reject provider requests with opaque JSON-RPC errors. They should receive policy denial responses.
- Remove any remaining non-permission pending-input code if it exists.

Exit criteria:

- Lifecycle tests cover `ask` registering an interaction and `deny` not registering one.
- Runtime tests cover provider request denial when no interactive handler is available.
- App/CLI surfaces only expose permission approval flows.

### Phase 6: App And CLI Surfaces

- App permission picker labels:
  - `Full`
  - `Workspace Write`
  - `Readonly`
- CLI `--permission-mode` accepts `full`, `workspace-write`, and `readonly`.
- Keep app styling consistent with existing prompt controls and thread banners.
- Pi should only show `Full`.
- Explain modes in user-facing copy without provider-native terms.

Suggested copy:

- `Full`: "No permission prompts. The agent can use full provider permissions."
- `Workspace Write`: "Can edit and run safely inside the workspace. Asks before leaving that boundary."
- `Readonly`: "Can inspect files. Asks before edits, shell commands, network, or other changes."

Managed/automation copy should use "denies" instead of "asks" where shown.

Exit criteria:

- App tests cover provider capability filtering and selected mode persistence.
- CLI tests cover parsing, help/error output, and API payloads.
- No UI references to `limited`.

### Phase 7: Validation

Required validation:

```sh
pnpm exec turbo run typecheck
pnpm exec turbo run test
pnpm exec turbo run test --filter=@bb/server-contract --filter=@bb/host-daemon-contract --filter=@bb/agent-runtime --filter=@bb/server
git diff --check
```

Provider smoke validation:

- Codex direct `workspace-write`: workspace file write succeeds; out-of-envelope action prompts.
- Codex direct `readonly`: read succeeds; write prompts; denied write does not mutate.
- Codex managed `readonly`: read succeeds; write denied without pending interaction.
- Claude direct `workspace-write`: workspace file write succeeds; safe workspace Bash succeeds under sandbox; outside Bash prompts or asks for unsandbox access.
- Claude managed `workspace-write`: workspace file write succeeds; outside Bash is denied without pending interaction.
- Claude direct `readonly`: read succeeds; write/Bash route to pending interactions.
- Claude managed `readonly`: read succeeds; write/Bash denied without pending interaction.
- Pi only exposes/runs `full`.

## Open Decisions

1. Codex approval policy for `workspace-write + ask`: choose between `on-request`, `on-failure`, or granular approval after a focused provider smoke test.
2. Whether Claude `readonly + ask` should allow approved Bash to run sandboxed. Recommended default: if approved, run through Claude sandbox where possible.
3. Whether managed `workspace-write` should allow network inside sandbox. Recommended default: deny network unless we have a product requirement for managed network access.

## Non-Goals

- Do not support generic provider question prompts in this pass.
- Do not expose `permissionEscalation` publicly.
- Do not make Pi pretend to support restricted modes.
- Do not use Claude `plan` as bb readonly.
- Do not leave provider-specific policy logic in domain types.
