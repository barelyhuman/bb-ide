# Route Audit

Current inline docs from the contract packages. Review for accuracy.

Delete this file after review — the source of truth is the inline JSDoc in the contract files.

---

## Public API (`@bb/server-contract`)

### Projects

| Route | Inline doc |
|---|---|
| `GET /projects` | *(none — self-evident)* |
| `POST /projects` | *(none — self-evident)* |
| `GET /projects/:id` | *(none — self-evident)* |
| `PATCH /projects/:id` | *(none — self-evident)* |
| `DELETE /projects/:id` | Also cleans up attachment files for the project. |
| `POST /projects/:id/sources` | *(none — self-evident)* |
| `PATCH /projects/:id/sources/:sourceId` | *(none — self-evident)* |
| `DELETE /projects/:id/sources/:sourceId` | *(none — self-evident)* |
| `GET /projects/:id/files` | Search files in the project. Used for file mentions in the prompt box. Proxies to `workspace.list_files` on the project's default source host. |
| `POST /projects/:id/attachments` | Upload a file attachment. Used to attach files to user messages. |
| `GET /projects/:id/attachments/content` | Serve an uploaded attachment's content. Used to render attachment previews. |
| `POST /projects/:id/managers` | Create a manager thread for the project. Same flow as POST /threads with type="manager". |

### Hosts

| Route | Inline doc |
|---|---|
| `GET /hosts` | Host `status` is derived at query time from sessions (not stored in DB). |
| `GET /hosts/:id` | *(none — self-evident)* |

### Environments

| Route | Inline doc |
|---|---|
| `GET /environments/:id` | *(none — self-evident, 404 if not found)* |
| `GET /environments/:id/status` | Get workspace status (git state) for an environment. Proxies to `workspace.status`. |
| `GET /environments/:id/diff` | Get git diff for an environment's workspace. Proxies to `workspace.diff`. |
| `GET /environments/:id/diff/branches` | List git branches. Proxies to `workspace.list_branches`. |
| `POST /environments/:id/actions` | Execute an environment action (commit, squash_merge, promote, demote). Requires `initiatingThreadId`. Returns 409 if blocked by environment state. |

### Threads

| Route | Inline doc |
|---|---|
| `GET /threads` | List threads. Supports filters: projectId, type, parentThreadId, archived. |
| `POST /threads` | Create a thread with environment provisioning. Environment type determines the flow: "reuse" attaches to existing, "host" + unmanaged/managed provisions new, "sandbox-host" returns 501. If input is provided, starts automatically after provisioning. Title generated asynchronously if not provided. |
| `GET /threads/:id` | *(none — self-evident)* |
| `PATCH /threads/:id` | Update thread metadata. If the title changes, also notifies the provider via `thread.rename`. |
| `DELETE /threads/:id` | Delete a thread. Also destroys its environment if one exists. |
| `POST /threads/:id/send` | Send a message to a thread. Idle thread → starts a new turn. Active thread with mode=steer → steers the current turn. |
| `POST /threads/:id/drafts` | Create a draft message for later sending. |
| `POST /threads/:id/drafts/:draftId/send` | Send a previously created draft. Starts or steers a turn, then deletes the draft. |
| `DELETE /threads/:id/drafts/:draftId` | *(none — self-evident)* |
| `POST /threads/:id/stop` | Stop an active thread. |
| `POST /threads/:id/archive` | Archive a thread. Rejects if uncommitted work exists (unless force=true). Stops the thread if active. Cleans up managed environments with no remaining threads. |
| `POST /threads/:id/unarchive` | Unarchive a thread. |
| `POST /threads/:id/read` | Mark thread as read. |
| `POST /threads/:id/unread` | Mark thread as unread. |
| `GET /threads/:id/timeline` | Get thread timeline for UI rendering. Events transformed via `@bb/core-ui`. |
| `GET /threads/:id/timeline/tool-details` | Get tool call details for a turn. Used by the UI to lazy-load expanded tool information. |
| `GET /threads/:id/output` | Get the thread's final output text. |
| `GET /threads/:id/events` | Get raw thread events. Supports `afterSeq` and `limit` pagination. |
| `GET /threads/:id/default-execution-options` | Get default execution options for the next message. |
| `GET /threads/:id/workspace/files` | List files in the thread's workspace. Resolves thread → environment → host, proxies to `workspace.list_files`. |
| `GET /threads/:id/workspace/file` | Read a single file from the thread's workspace. Proxies to `workspace.read_file`. |

### System

| Route | Inline doc |
|---|---|
| `GET /system/config` | Get server configuration. Returns `{ hostDaemonPort }`. |
| `GET /system/models` | List available models. Proxies to `provider.list_models`. Can target a specific host or environment. |
| `GET /system/providers` | List available providers. Proxies to `provider.list`. Can target a specific host or environment. |
| `POST /system/voice-transcription` | Transcribe audio to text. Accepts audio file and optional prompt context. |

---

## Internal API (`@bb/host-daemon-contract` session routes)

| Route | Inline doc |
|---|---|
| `POST /internal/session/open` | Daemon opens a session with the server. Server upserts the host record, creates a new session, and closes any existing session for the same hostId (sends `session-close` with reason "replaced" over the old WS). Runs reconciliation: compares the daemon's reported `activeThreads` against DB state. Returns sessionId, heartbeat config, and threadHighWaterMarks. |
| `GET /internal/session/commands` | Daemon polls for pending commands. Long-poll: if no commands are available and `waitMs > 0`, the server holds the request open up to `waitMs` milliseconds. Returns 204 if timeout with no commands. Cursor-based pagination via `afterCursor` and `limit`. |
| `POST /internal/session/command-result` | Daemon reports command completion. Handles provisioning results: success → environment ready, failure → environment+thread error. On provision success with pending input, queues `thread.start`. Updates server-side cursor (contiguous advancement only). Fires WS notifications. |
| `POST /internal/session/events` | Daemon posts a batch of thread events. Deduplicates by (threadId, sequence). Returns threadHighWaterMarks for ack. Side effects: `turn/completed` → thread idle; if managed thread, notifies parent. |
| `POST /internal/session/tool-call` | Daemon proxies a tool call to the server. Currently only `spawn_thread` supported — creates a child thread that reuses the parent's environment. |

---

## Daemon Commands (`@bb/host-daemon-contract` commands)

### Thread commands (not lane-serialized)

| Command | Inline doc |
|---|---|
| `thread.start` | Start a new provider session for a thread. Daemon creates/ensures runtime using `workspacePath`, calls `runtime.startThread()`. Result: `{ providerThreadId }`. |
| `thread.resume` | Resume an existing provider session after daemon restart. Daemon creates/ensures runtime, calls `runtime.resumeThread()` with prior `providerThreadId`. Includes `workspacePath` so daemon can recreate runtime if lost. Result: `{ providerThreadId }`. |
| `turn.run` | Execute a conversation turn. Daemon calls `runtime.runTurn()`. Events flow back via POST /session/events. If runtime doesn't exist (post-restart), lazily recreates via `resolveThreadRuntime` + `resumeThread`. Result: `{}`. |
| `turn.steer` | Steer an active turn mid-execution. Daemon calls `runtime.steerTurn()` with `expectedTurnId` and new input. Result: `{}`. |
| `thread.stop` | Stop an active thread's provider session. Daemon calls `runtime.stopThread()`, marks thread inactive. Result: `{}`. |
| `thread.rename` | Rename a thread on the provider side. Daemon calls `runtime.renameThread()`. Sent when user changes title or auto-title generates one. Result: `{}`. |

### Provider commands (not lane-serialized)

| Command | Inline doc |
|---|---|
| `provider.list` | List available providers. Daemon calls `listAvailableProviderInfos()` from agent-runtime. Not environment-scoped. Result: `{ providers: ProviderInfo[] }`. |
| `provider.list_models` | List available models for a specific provider. Daemon calls `createProviderForId(providerId).listModels()`. Not environment-scoped. Result: `{ models: AvailableModel[] }`. |

### Environment commands (lane-serialized per environmentId)

| Command | Inline doc |
|---|---|
| `environment.provision` | Provision a workspace. Discriminated by `workspaceProvisionType`: unmanaged (validates path, discovers git props), managed-worktree (creates worktree + setup script), managed-clone (clones repo + setup script). Idempotent. Rolls back on failure. Result: `{ path, isGitRepo, isWorktree, branchName, ranSetup }`. |
| `environment.destroy` | Destroy workspace and runtime. Shuts down AgentRuntime, calls `workspace.destroy()`. Idempotent — no-op if not found. Server ensures threads are stopped before sending. Result: `{}`. |

### Workspace commands (lane-serialized per environmentId)

| Command | Inline doc |
|---|---|
| `workspace.status` | Get git/workspace status. Result: `{ workspaceStatus }` with state, changed files, branch info. |
| `workspace.diff` | Get git diff. Accepts `mergeBaseBranch` and `selection`. Result: `{ diff }` with diff text, commits, branch info. |
| `workspace.commit` | Commit changes. Takes `message` and optional `includeUnstaged`. Result: `{ commitSha, commitSubject }`. |
| `workspace.squash_merge` | Squash-merge into target branch. Takes `targetBranch` and `commitMessage`. Result: `{ merged, commitSha }`. |
| `workspace.reset` | Reset workspace to clean state. Result: `{}`. |
| `workspace.checkpoint` | Checkpoint (commit + push). Takes `commitMessage` and optional `remoteName`. Result: `{ commitSha, branchName, remoteName }`. |
| `workspace.promote` | Promote environment branch to primary checkout. Checks both workspaces clean, detaches source HEAD, checks out env branch on primary. Result: `{ ok: true }`. |
| `workspace.demote` | Demote environment back from primary checkout. Restores primary to `defaultBranch`, checks out `envBranch` on environment. Result: `{ ok: true }`. |
| `workspace.list_files` | List files in workspace. Uses `git ls-files` (falls back to readdir for non-git). Optional `query` filter. Result: `{ files: [{ path, name }] }`. |
| `workspace.read_file` | Read a single file. Path traversal protection. Result: `{ path, content }`. |
| `workspace.list_branches` | List git branches. Result: `{ branches, current }`. |

### Wire format

| Schema | Inline doc |
|---|---|
| `hostDaemonCommandEnvelopeSchema` | Wire format: `{ id, cursor, command }`. Each command is self-describing. `cursor` is per-host monotonic. |
| `hostDaemonCommandResultReportSchema` | Result report union. Success includes typed result. Error includes errorCode + errorMessage. Unknown commands use errorCode `"unknown_command"`. |
