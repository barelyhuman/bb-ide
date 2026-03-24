# Phase 2b Findings: apps/app Cut-Over to New Contracts

## Resolved

- All type renames applied (SpawnThread→CreateThread, Tell→Send, etc.)
- All route renames applied (tell→send, queue→drafts, operations→actions, etc.)
- All function/hook renames applied
- `ThreadChangeKind` import moved from `@bb/server-contract` to `@bb/domain`
- `steer-if-active` → `auto` send mode
- `projectInstructions` / `ProjectSettingsView` deleted
- SystemRestart*, SystemStatus, ServerRuntimeMode, StatusFooter deleted
- `demotePrimaryIfNeeded` removed from send message
- `includeArchived` → `archived` filter
- `/system/provider` (singular) → removed, use `/system/providers`
- Dead code swept via knip (8 files deleted, 19 files cleaned)
- `ThreadQueuedMessage.input` → `.content`
- Project response now includes sources (no separate route)
- Workspace status moved to `GET /environments/:id/status`
- `isPromoted` dropped from API
- `provisioned` / `provisioning_failed` removed from switch statements
- `titleFallback` added back to domain type

## Remaining: ~120 type errors

### Needs hostId atom + source rework (~12 errors)

The app needs a `localHostIdAtom` (jotai) populated from daemon `GET /host-id` on startup. `null` when no local daemon.

| Issue | Errors | What needs to happen |
|---|---|---|
| `project.rootPath` references | 8 | Use `project.sources.find(s => s.hostId === localHostId)?.path` |
| `useQuickCreateProject` passes `rootPath` | 1 | Pass `{ hostId, sourcePath }` from source lookup |
| "Change/repair project path" in ProjectList | 2 | Update/add project source, not `rootPath` on project |
| `rootPathExists` check | 1 | Keep stub for now — needs daemon local API to check |

Environment creation args should NOT include the path — just `{ hostId, provisioningType }`. Server resolves the source path from project_sources.

### Needs code rework (~44 errors)

| Issue | Errors | What needs to happen |
|---|---|---|
| `attachedEnvironment` on Thread | 14 | Fetch environment separately via `GET /environments/:environmentId`. Thread only has `environmentId`. |
| `primaryCheckout` on Thread | 6 | Derive from environment branchName vs primary source branch. No API field. |
| `Environment.properties` (old shape) | 8 | Update to use new Environment fields (`path`, `hostId`, `managed`, `isGitRepo`, `branchName`, `status`) |
| `SystemEnvironmentInfo` | 6 | Replace with `/environments` + `/hosts` queries |
| `workStatus` on Thread | 2 | Fetch from `GET /environments/:id/status` |
| `queuedMessages` on Thread | 2 | Separate fetch, not inlined on Thread |
| `ThreadStatusShape` mismatches | 6 | Update helper types to match new Thread shape |

### Needs decision (~10 errors)

| Issue | Errors | Options |
|---|---|---|
| `PromptMentionSuggestion` | 4 | Add file mention type to contract, or remove @-mention feature for now |
| `UploadedPromptAttachment` | 3 | Add attachment type to contract, or remove attachment upload for now |
| `EnvironmentCapabilities` | 3 | Export from `@bb/domain`, or derive from environment properties |
