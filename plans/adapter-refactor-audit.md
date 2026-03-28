# Adapter Refactor Audit Findings

## Summary

The current pipeline preserves most raw tool arguments, but it preserves them in the wrong place. Provider adapters still defer tool classification to shared translation tables and stage-2 routing, which forces later layers to recover semantics that the adapter already knew. The largest correctness issues are the Claude Agent format-then-reparse loop, generic tool-call routing for Claude/Pi structured tools, stale verification around subagent output, and renderer workarounds that compensate for malformed intents.

## Findings

### F1. Shared adapter routing strips provider ownership of tool semantics

- Evidence:
  - `packages/agent-runtime/src/shared/adapter-utils.ts` only specializes bash, file-edit, and web-search tools.
  - Everything else falls through to generic `toolCall`.
  - `packages/agent-runtime/src/claude-code/adapter.ts` and `packages/agent-runtime/src/pi/adapter.ts` both call `translateToolCallToItem()` / `translateToolResultToItem()`.
- Current impact:
  - Claude `Read`, `Glob`, `Grep`, `Agent`, `ToolSearch`, and `TodoWrite` do not become provider-owned item types in stage 1.
  - Pi `read`, `grep`, and `find` do not become provider-owned item types in stage 1.
  - Stage 2 has to know tool names and arg shapes that belong to the adapters.
- Resolution: fix in phase 1.

### F2. Claude Agent delegation is structured in raw events but flattened into a display string

- Evidence:
  - Claude raw `tool_use` payloads include structured `subagent_type`, `description`, and `prompt`.
  - `packages/core-ui/src/tool-call-parsing.ts` formats those fields into `Agent [Type] Description`.
  - `packages/core-ui/src/semantic-view-messages.ts` only forwards `command` to `ViewDelegationMessage`.
  - `packages/ui-core/src/thread-timeline/rows/DelegationRow.tsx` regex-parses the command string back into agent type and description.
- Current impact:
  - Delegation structure exists at the provider boundary, is flattened in stage 2, then reconstructed in stage 4.
  - The renderer is compensating for upstream data loss.
- Resolution:
  - fix classification/field preservation in phase 1
  - fix view-message propagation in phase 2
  - remove regex parsing in phase 4

### F3. Claude Agent output cleanup is correct in code, but verification still encodes the old summarized form

- Evidence:
  - `packages/core-ui/src/tool-call-parsing.ts` strips `agentId:` and `<usage>` lines, but does not synthesize a `Subagent report:` summary.
  - `packages/core-ui/test/exec-lifecycle.test.ts` still asserts `Subagent report: Docs directory overview`.
  - `packages/provider-audit/test/__snapshots__/replay-fixtures.test.ts.snap` still contains multiple `Subagent report:` lines.
- Current impact:
  - The implementation already preserves the full metadata-stripped output.
  - Tests and fixture snapshots still describe the old behavior, which hides whether later phases keep that improvement intact.
- Resolution: fix in phase 2.

### F4. Claude structured read/search/list tools are preserved only as generic tool arguments

- Evidence:
  - Claude raw events carry structured args for `Read`, `Glob`, and `Grep`.
  - Those tool calls currently become generic `toolCall` items with `arguments`.
  - `packages/core-ui/src/tool-call-parsing.ts` then reconstructs exploring intents with `toolNameToParsedIntents()`.
- Current impact:
  - No immediate data loss, but stage 2 is doing provider-specific field extraction that belongs in stage 1.
  - Bug fixes depend on keeping tool-name routing tables in sync with adapter behavior.
- Resolution:
  - fix adapter ownership in phase 1
  - replace stage-2 routing-table parsing with direct field mapping in phase 2

### F5. Pi already exposes structured tool names, but the adapter still emits generic tool calls for read/search/list activity

- Evidence:
  - Pi raw provider events include discrete `toolName` values such as `read`, `grep`, `find`, `edit`, `write`, and `bash`.
  - `packages/agent-runtime/src/pi/adapter.ts` still delegates translation to the shared helper.
- Current impact:
  - Pi exploration steps are classified after translation instead of at the adapter boundary.
  - Stage 2 has to infer read/search/list semantics from tool names and shell parsing instead of receiving typed items directly.
- Resolution: fix in phase 1.

### F6. Pi tool-result text is preserved, but duration is not

- Evidence:
  - Pi emits `tool_execution_start` and `tool_execution_end` as separate events.
  - The translated items do not compute `durationMs`.
- Current impact:
  - Tool rows for Pi cannot show elapsed time even though start/end timing is available from capture timestamps.
- Resolution: defer in this audit.
  - The main implementation plan already schedules this for phase 5.

### F7. Codex command executions still rely on shell parsing, and read intents carry `name: "exec_command"`

- Evidence:
  - `packages/core-ui/src/tool-call-parsing.ts` returns read intents with `name: "exec_command"` for shell reads.
  - `packages/core-ui/test/tool-call-parsing.test.ts` and `packages/core-ui/test/exec-lifecycle.test.ts` assert that shape today.
  - `packages/ui-core/src/thread-timeline/rows/ToolExploringRow.tsx` works around it by validating path-looking strings before treating an intent as a read.
- Current impact:
  - Stage 4 cannot trust read intents.
  - The renderer has to inspect filenames and fall back to raw commands.
- Resolution:
  - fix shell intent shaping in phase 2
  - remove renderer workarounds in phase 4

### F8. Codex raw events contain `commandActions`, but the adapter drops them

- Evidence:
  - Codex raw `commandExecution` items in provider-audit fixtures include `commandActions` entries with structured search metadata.
  - `packages/agent-runtime/src/codex/adapter.ts` does not map `commandActions` onto `ThreadEventItem`.
- Current impact:
  - We ignore potentially useful upstream structure and fall back to shell parsing.
- Resolution: defer.
  - The current plan explicitly keeps Codex shell classification in stage 2. Carrying `commandActions` would be a larger domain-shape change than this refactor requires.

### F9. The shell parser still leaks parser-shaped data into the UI

- Evidence:
  - `packages/core-ui/src/tool-call-parsing.ts` handles shell classification for generic command executions.
  - `ToolExploringRow` includes `cleanSearchQuery()` to strip regex noise introduced upstream.
  - Shell-read intents still carry `name: "exec_command"` instead of a meaningful read name.
- Current impact:
  - Search queries and read intents are not fully trustworthy at the renderer boundary.
  - The UI contains cleanup logic that belongs upstream.
- Resolution:
  - fix intent shaping in phase 2
  - remove UI cleanup workarounds in phase 4

### F10. Delegation and exploring renderers are compensating for malformed upstream data

- Evidence:
  - `packages/ui-core/src/thread-timeline/rows/DelegationRow.tsx` has `parseDelegationCommand()`.
  - `packages/ui-core/src/thread-timeline/rows/ToolExploringRow.tsx` has `looksLikeFilePath()`, `isReadOnlyIntent()`, and `cleanSearchQuery()`.
- Current impact:
  - Stage 4 is re-parsing and reclassifying data instead of rendering trusted input.
  - Bugs in stages 1 and 2 are masked rather than fixed at the source.
- Resolution: fix in phase 4 after upstream data is corrected in phases 1 and 2.

### F11. CLI verification still encodes the old delegation output shape

- Evidence:
  - Provider-audit snapshots still show `Subagent report:` summaries.
  - `packages/core-ui/src/format-timeline-text.ts` renders `msg.output` directly, so the current CLI formatter is not synthesizing those summaries itself.
- Current impact:
  - Snapshot verification is stale, so it cannot be trusted as evidence of current CLI delegation behavior.
- Resolution: defer in this audit.
  - The main implementation plan already schedules this for phase 6 after the upstream stages are corrected.

## Phase Mapping

| Finding | Planned fix |
| --- | --- |
| F1 | Phase 1 |
| F2 | Phases 1, 2, 4 |
| F3 | Phase 2 |
| F4 | Phases 1, 2 |
| F5 | Phase 1 |
| F6 | Defer |
| F7 | Phases 2, 4 |
| F8 | Defer |
| F9 | Phases 2, 4 |
| F10 | Phase 4 |
| F11 | Defer |

## Deferred Notes

- `F6` is already scheduled in the main plan's phase 5. It is marked `Defer` here only because the phase-0 deliverable asks for findings to be categorized as phase 1, phase 2, phase 4, or defer.
- `F11` is already scheduled in the main plan's phase 6. It is marked `Defer` here for the same reason.
