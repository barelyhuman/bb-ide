# Route Audit

Current inline docs from the contract packages. Review for accuracy.

Delete this file after review — the source of truth is the inline JSDoc in the contract files.

---

## Public API (`@bb/server-contract`)

### Projects

| Route | Inline doc |
|---|---|
| `GET /projects` | |
| `POST /projects` | |
| `GET /projects/:id` | |
| `PATCH /projects/:id` | |
| `DELETE /projects/:id` | Also cleans up attachment files for the project. |
| `POST /projects/:id/sources` | |
| `PATCH /projects/:id/sources/:sourceId` | |
| `DELETE /projects/:id/sources/:sourceId` | |
| `GET /projects/:id/files` | Search files in the project. Used for file mentions in the prompt box. Proxies to `workspace.list_files` on the project's default source host. |
| `POST /projects/:id/attachments` | Upload a file attachment. Used to attach files to user messages. |
| `GET /projects/:id/attachments/content` | Serve an uploaded attachment's content. Used to render attachment previews. |
| `POST /projects/:id/managers` | Same flow as POST /threads with type="manager". |

### Hosts

| Route | Inline doc |
|---|---|
| `GET /hosts` | Host `status` is derived at query time from the `host_daemon_sessions` table. |
| `GET /hosts/:id` | |

### Environments

| Route | Inline doc |
|---|---|
| `GET /environments/:id` | |
| `GET /environments/:id/status` | Proxies to `workspace.status`. |
| `GET /environments/:id/diff` | Proxies to `workspace.diff`. |
| `GET /environments/:id/diff/branches` | Proxies to `workspace.list_branches`. |
| `POST /environments/:id/actions` | Execute an environment action (commit, squash_merge, promote, demote). Requires `initiatingThreadId`. Returns 409 if blocked by environment state. |

### Threads

| Route | Inline doc |
|---|---|
| `GET /threads` | Supports filters: projectId, type, parentThreadId, archived. |
| `POST /threads` | Environment type determines the flow: "reuse" attaches to existing, "host" + unmanaged/managed provisions new, "sandbox-host" returns 501. If input is provided, starts automatically after provisioning. Title generated asynchronously if not provided. |
| `GET /threads/:id` | |
| `PATCH /threads/:id` | If the title changes, also notifies the provider via `thread.rename`. |
| `DELETE /threads/:id` | Also destroys its environment if one exists. |
| `POST /threads/:id/send` | Idle thread → starts a new turn. Active thread with mode=steer → steers the current turn. |
| `POST /threads/:id/drafts` | |
| `POST /threads/:id/drafts/:draftId/send` | Starts or steers a turn, then deletes the draft. |
| `DELETE /threads/:id/drafts/:draftId` | |
| `POST /threads/:id/stop` | |
| `POST /threads/:id/archive` | Rejects if uncommitted work exists (unless force=true). Stops the thread if active. Cleans up managed environments with no remaining threads. |
| `POST /threads/:id/unarchive` | |
| `POST /threads/:id/read` | |
| `POST /threads/:id/unread` | |
| `GET /threads/:id/timeline` | Events transformed via `@bb/core-ui`. |
| `GET /threads/:id/timeline/tool-details` | Used by the UI to lazy-load expanded tool information. |
| `GET /threads/:id/output` | |
| `GET /threads/:id/events` | Supports `afterSeq` and `limit` pagination. |
| `GET /threads/:id/default-execution-options` | |
| `GET /threads/:id/workspace/files` | Resolves thread → environment → host, proxies to `workspace.list_files`. |
| `GET /threads/:id/workspace/file` | Proxies to `workspace.read_file`. |

### System

| Route | Inline doc |
|---|---|
| `GET /system/config` | |
| `GET /system/models` | Proxies to `provider.list_models`. Can target a specific host or environment. |
| `GET /system/providers` | Proxies to `provider.list`. Can target a specific host or environment. |
| `POST /system/voice-transcription` | Accepts audio file and optional prompt context. |

---

## Internal API (`@bb/host-daemon-contract` session routes)

| Route | Inline doc |
|---|---|
| `POST /internal/session/open` | Server upserts host, creates session, closes any existing session for the same hostId (sends `session-close` reason "replaced"). Runs reconciliation against daemon's `activeThreads`. Returns sessionId, heartbeat config, threadHighWaterMarks. |
| `GET /internal/session/commands` | Long-poll: holds request up to `waitMs` if no commands available. Returns 204 on timeout. Cursor-based pagination. |
| `POST /internal/session/command-result` | Handles provisioning results: success → environment ready, failure → error. On provision success with pending input, queues `thread.start`. Contiguous cursor advancement. Fires WS notifications. |
| `POST /internal/session/events` | Deduplicates by (threadId, sequence). Returns threadHighWaterMarks. `turn/completed` → thread idle; notifies parent if managed thread. |
| `POST /internal/session/tool-call` | Currently only `spawn_thread` supported — creates a child thread reusing the parent's environment. |

---

## Daemon Commands (`@bb/host-daemon-contract`)

### Thread commands (not lane-serialized)

| Command | Inline doc |
|---|---|
| `thread.start` | Creates/ensures runtime using `workspacePath`, calls `runtime.startThread()`. Result: `{ providerThreadId }`. |
| `thread.resume` | Recreates runtime if lost, calls `runtime.resumeThread()` with prior `providerThreadId`. Result: `{ providerThreadId }`. |
| `turn.run` | Calls `runtime.runTurn()`. Events flow back via POST /session/events. Lazily recreates runtime if needed. Result: `{}`. |
| `turn.steer` | Calls `runtime.steerTurn()` with `expectedTurnId`. Result: `{}`. |
| `thread.stop` | Calls `runtime.stopThread()`, marks thread inactive. Result: `{}`. |
| `thread.rename` | Calls `runtime.renameThread()`. Sent on user rename or auto-title. Result: `{}`. |

### Provider commands (not lane-serialized)

| Command | Inline doc |
|---|---|
| `provider.list` | Returns all providers the daemon knows about. Not environment-scoped. Result: `{ providers }`. |
| `provider.list_models` | Returns models for a specific provider. Result: `{ models }`. |

### Environment commands (lane-serialized per environmentId)

| Command | Inline doc |
|---|---|
| `environment.provision` | Discriminated by `workspaceProvisionType`: unmanaged (validates path), managed-worktree (creates worktree), managed-clone (clones repo). Idempotent. Rolls back on failure. Result: `{ path, isGitRepo, isWorktree, branchName, ranSetup }`. |
| `environment.destroy` | Shuts down runtime, destroys workspace. Idempotent. Server ensures threads are stopped first. Result: `{}`. |

### Workspace commands (lane-serialized per environmentId)

| Command | Inline doc |
|---|---|
| `workspace.status` | Result: `{ workspaceStatus }` with state, changed files, branch info. |
| `workspace.diff` | Accepts `mergeBaseBranch` and `selection`. Result: `{ diff }`. |
| `workspace.commit` | Takes `message` and optional `includeUnstaged`. Result: `{ commitSha, commitSubject }`. |
| `workspace.squash_merge` | Takes `targetBranch` and `commitMessage`. Result: `{ merged, commitSha }`. |
| `workspace.reset` | Result: `{}`. |
| `workspace.checkpoint` | Commit + push. Takes `commitMessage` and optional `remoteName`. Result: `{ commitSha, branchName, remoteName }`. |
| `workspace.promote` | Checks both workspaces clean, switches primary checkout to env branch. Result: `{ ok }`. |
| `workspace.demote` | Reverses promote — restores primary to `defaultBranch`. Result: `{ ok }`. |
| `workspace.list_files` | Uses `git ls-files` (falls back to readdir). Optional `query` filter. Result: `{ files }`. |
| `workspace.read_file` | Path traversal protection. Result: `{ path, content }`. |
| `workspace.list_branches` | Result: `{ branches, current }`. |
