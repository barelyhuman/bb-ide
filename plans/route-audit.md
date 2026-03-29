# Server & Host-Daemon Route Audit

All individual audits live in `plans/route-audit/`. One file per route/command. **77 files total.**

**Workflow:** Review each file. Delete files that need no action. Leave comments in the `## Review Comments` section for files that need follow-up.

## Top Findings (cross-cutting)

### Bugs
- **`GET /attachments/content`** — serves all files as `application/octet-stream` (mimeType never returned)
- **`POST /system/voice-transcription`** — throws plain Error instead of ApiError(400) for missing file → 500
- **`workspace.status`** — silently drops `mergeBaseBranch` (StatusOptions not forwarded)

### Security
- **Daemon local API `cors({ origin: "*" })`** — any webpage can hit `POST /open`, `POST /restart`, `POST /pick-folder`
- **`GET /ws`** — no authentication on client WebSocket
- **`GET /threads/:id/workspace/file`** — passes user-provided `path` to daemon; path traversal protection unconfirmed

### Dead Params (AGENTS.md violation: "accepted-but-ignored fields are forbidden")
- `turnId` in `GET /threads/:id/timeline/tool-details`
- `limit` in `GET /threads/:id/workspace/files`
- `projectId` in `environment.provision`
- `path` + `workspaceProvisionType` in `environment.destroy`
- `threadId` in `workspace.promote` and `workspace.demote`
- `cursor` + `completedAt` in `POST /session/command-result`
- `events[].id` + `events[].createdAt` in `POST /session/events`
- `requestId` in `POST /session/tool-call`
- `activeThreads[].providerThreadId` + `activeThreads[].environmentId` in `POST /session/open`
- `bufferDepth` + `lastCommandCursor` in daemon WebSocket heartbeat

### Missing Guards
- `DELETE /threads/:id` — no guard against deleting active thread mid-run
- `POST /threads/:id/stop` — no status guard (sends stop even if not active)
- `POST /threads/:id/unarchive` — no 404 check; doesn't re-provision destroyed environments
- `DELETE /projects/:id` — no daemon cleanup of managed worktrees/clones on disk
- `DELETE /projects/:id/sources/:sourceId` — can delete last source, breaking dependent routes
- `POST /projects/:id/sources` — unique constraint throws raw 500 instead of 409

### Design Questions
- `POST /threads` accepts `type: "manager"` — should this be restricted to `"standard"` only?
- `sandboxMode` defaults to `"danger-full-access"` — intentional?
- `"sandbox-host"` accepted in schema but throws 501
- `dynamicTools` in `turn.run`/`turn.steer` schemas are silently ignored (only applied on start/resume)

### Performance
- `GET /threads` — no pagination, no ORDER BY, `type` filter has no index
- `GET /threads/:id/timeline` + `/events` — default limit is `Number.MAX_SAFE_INTEGER`
- `GET /system/models` — N+1 fan-out (1+P daemon commands when no providerId)
- `GET /session/commands` — N+1 per-command UPDATE + re-SELECT in fetchCommands
- `workspace.read_file` — no file size limit

### Dead Code / Unused
- **`workspace.reset`** and **`workspace.checkpoint`** — daemon commands with zero server-side callers (never queued)
- **`thread.resume`** — never explicitly queued by the server; only triggered implicitly by daemon auto-resume
- **`queueThreadStopCommand`** wrapper — exists but never called; both stop callers queue directly
- **`GET /status`** and **`POST /restart`** (daemon local API) — zero production callers, test-only
- **`removeProjectSource`** — exported from app API client but no frontend caller
- **`GET /hosts/:id`** — only 2 callers (test helper + 1 test)

---

## File Naming Convention

- `server-METHOD-path.md` — server public routes
- `server-internal-METHOD-path.md` — server internal routes
- `server-ws-name.md` — WebSocket endpoints
- `daemon-METHOD-path.md` — host-daemon local API routes
- `daemon-cmd-name.md` — host-daemon commands

## Inventory

### Server Public Routes
- [x] `GET /projects` → `server-GET-projects.md`
- [x] `POST /projects` → `server-POST-projects.md`
- [x] `GET /projects/:id` → `server-GET-projects-id.md`
- [x] `PATCH /projects/:id` → `server-PATCH-projects-id.md`
- [x] `DELETE /projects/:id` → `server-DELETE-projects-id.md`
- [x] `POST /projects/:id/sources` → `server-POST-projects-id-sources.md`
- [x] `PATCH /projects/:id/sources/:sourceId` → `server-PATCH-projects-id-sources-sourceId.md`
- [x] `DELETE /projects/:id/sources/:sourceId` → `server-DELETE-projects-id-sources-sourceId.md`
- [x] `GET /projects/:id/files` → `server-GET-projects-id-files.md`
- [x] `POST /projects/:id/attachments` → `server-POST-projects-id-attachments.md`
- [x] `GET /projects/:id/attachments/content` → `server-GET-projects-id-attachments-content.md`
- [x] `POST /projects/:id/managers` → `server-POST-projects-id-managers.md`
- [x] `GET /hosts` → `server-GET-hosts.md`
- [x] `GET /hosts/:id` → `server-GET-hosts-id.md`
- [x] `GET /environments/:id` → `server-GET-environments-id.md`
- [x] `GET /environments/:id/status` → `server-GET-environments-id-status.md`
- [x] `GET /environments/:id/diff` → `server-GET-environments-id-diff.md`
- [x] `GET /environments/:id/diff/branches` → `server-GET-environments-id-diff-branches.md`
- [x] `POST /environments/:id/actions` → `server-POST-environments-id-actions.md`
- [x] `GET /system/config` → `server-GET-system-config.md`
- [x] `GET /system/providers` → `server-GET-system-providers.md`
- [x] `GET /system/models` → `server-GET-system-models.md`
- [x] `POST /system/voice-transcription` → `server-POST-system-voice-transcription.md`
- [x] `GET /threads` → `server-GET-threads.md`
- [x] `POST /threads` → `server-POST-threads.md`
- [x] `GET /threads/:id` → `server-GET-threads-id.md`
- [x] `PATCH /threads/:id` → `server-PATCH-threads-id.md`
- [x] `DELETE /threads/:id` → `server-DELETE-threads-id.md`
- [x] `POST /threads/:id/send` → `server-POST-threads-id-send.md`
- [x] `POST /threads/:id/drafts` → `server-POST-threads-id-drafts.md`
- [x] `POST /threads/:id/drafts/:draftId/send` → `server-POST-threads-id-drafts-draftId-send.md`
- [x] `DELETE /threads/:id/drafts/:draftId` → `server-DELETE-threads-id-drafts-draftId.md`
- [x] `POST /threads/:id/stop` → `server-POST-threads-id-stop.md`
- [x] `POST /threads/:id/archive` → `server-POST-threads-id-archive.md`
- [x] `POST /threads/:id/unarchive` → `server-POST-threads-id-unarchive.md`
- [x] `POST /threads/:id/read` → `server-POST-threads-id-read.md`
- [x] `POST /threads/:id/unread` → `server-POST-threads-id-unread.md`
- [x] `GET /threads/:id/timeline` → `server-GET-threads-id-timeline.md`
- [x] `GET /threads/:id/timeline/tool-details` → `server-GET-threads-id-timeline-tool-details.md`
- [x] `GET /threads/:id/output` → `server-GET-threads-id-output.md`
- [x] `GET /threads/:id/events` → `server-GET-threads-id-events.md`
- [x] `GET /threads/:id/default-execution-options` → `server-GET-threads-id-default-execution-options.md`
- [x] `GET /threads/:id/workspace/files` → `server-GET-threads-id-workspace-files.md`
- [x] `GET /threads/:id/workspace/file` → `server-GET-threads-id-workspace-file.md`

### Server Internal Routes
- [x] `POST /internal/session/open` → `server-internal-POST-session-open.md`
- [x] `GET /internal/session/commands` → `server-internal-GET-session-commands.md`
- [x] `POST /internal/session/command-result` → `server-internal-POST-session-command-result.md`
- [x] `POST /internal/session/events` → `server-internal-POST-session-events.md`
- [x] `POST /internal/session/tool-call` → `server-internal-POST-session-tool-call.md`
- [x] `GET /ws` → `server-ws-client.md`
- [x] `GET /internal/ws` → `server-ws-daemon.md`

### Host-Daemon Local API
- [x] `GET /host-id` → `daemon-GET-host-id.md`
- [x] `GET /status` → `daemon-GET-status.md`
- [x] `POST /open` → `daemon-POST-open.md`
- [x] `POST /pick-folder` → `daemon-POST-pick-folder.md`
- [x] `POST /restart` → `daemon-POST-restart.md`

### Host-Daemon Commands
- [x] `thread.start` → `daemon-cmd-thread-start.md`
- [x] `thread.resume` → `daemon-cmd-thread-resume.md`
- [x] `thread.stop` → `daemon-cmd-thread-stop.md`
- [x] `thread.rename` → `daemon-cmd-thread-rename.md`
- [x] `turn.run` → `daemon-cmd-turn-run.md`
- [x] `turn.steer` → `daemon-cmd-turn-steer.md`
- [x] `provider.list` → `daemon-cmd-provider-list.md`
- [x] `provider.list_models` → `daemon-cmd-provider-list-models.md`
- [x] `environment.provision` → `daemon-cmd-environment-provision.md`
- [x] `environment.destroy` → `daemon-cmd-environment-destroy.md`
- [x] `workspace.status` → `daemon-cmd-workspace-status.md`
- [x] `workspace.diff` → `daemon-cmd-workspace-diff.md`
- [x] `workspace.commit` → `daemon-cmd-workspace-commit.md`
- [x] `workspace.squash_merge` → `daemon-cmd-workspace-squash-merge.md`
- [x] `workspace.reset` → `daemon-cmd-workspace-reset.md`
- [x] `workspace.checkpoint` → `daemon-cmd-workspace-checkpoint.md`
- [x] `workspace.promote` → `daemon-cmd-workspace-promote.md`
- [x] `workspace.demote` → `daemon-cmd-workspace-demote.md`
- [x] `workspace.list_files` → `daemon-cmd-workspace-list-files.md`
- [x] `workspace.read_file` → `daemon-cmd-workspace-read-file.md`
- [x] `workspace.list_branches` → `daemon-cmd-workspace-list-branches.md`
