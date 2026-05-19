import type { ReactNode } from "react";
import type {
  TimelineNonOperationSystemRow,
  TimelineRow,
} from "@bb/server-contract";
import {
  ThreadTimelineRows,
  type ThreadTimelineRowsProps,
} from "@/components/thread/timeline";
import { StoryCard, StoryRow } from "../../../../../.ladle/story-card";

export default {
  title: "thread/timeline/rows/System",
};

type TimelineRowsStoryBaseProps = Omit<
  ThreadTimelineRowsProps,
  "initialExpanded" | "timelineRows"
>;

interface TimelineStageProps {
  children: ReactNode;
}

interface ErrorRowsPreviewProps {
  initialExpanded?: ReadonlySet<string>;
  rows: TimelineRow[];
}

function TimelineStage({ children }: TimelineStageProps) {
  return <div className="w-full max-w-[760px]">{children}</div>;
}

function ErrorRowsPreview({ initialExpanded, rows }: ErrorRowsPreviewProps) {
  return (
    <TimelineStage>
      <ThreadTimelineRows
        {...baseProps}
        initialExpanded={initialExpanded}
        timelineRows={rows}
      />
    </TimelineStage>
  );
}

const baseProps: TimelineRowsStoryBaseProps = {
  loadingTurnSummaryIds: new Set<string>(),
  erroredTurnSummaryIds: new Set<string>(),
  onLoadTurnSummaryRows: () => {},
  threadRuntimeDisplayStatus: "idle",
  turnSummaryRowsIdentity: "story",
  turnSummaryRowsById: {},
  workspaceRootPath: undefined,
};

// ---------------------------------------------------------------------------
// System error rows from ~/.bb-dev/bb.db. These fixtures use the projected
// TimelineSystemRow shape emitted by packages/thread-view/src/build-thread-
// timeline.ts, not raw event JSON. Source events were found with:
//
//   SELECT id, thread_id, turn_id, sequence, type, data
//   FROM events
//   WHERE type IN ('provider/error', 'system/error')
//   ORDER BY created_at DESC;
// ---------------------------------------------------------------------------

// thr_ggp8mmze2q, seq 5947..5952. The provider supplied willRetry=true on the
// reconnect rows; these legacy rows use the first useful detail line as title.
const providerStreamRetryAttempt1: TimelineNonOperationSystemRow = {
  id: "thr_ggp8mmze2q:error:5947",
  threadId: "thr_ggp8mmze2q",
  turnId: "019e3439-7692-7691-832f-a015ebaa50f5",
  sourceSeqStart: 5947,
  sourceSeqEnd: 5947,
  startedAt: 1778992960204,
  createdAt: 1778992960204,
  kind: "system",
  systemKind: "reconnect",
  title:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  detail:
    "Reconnecting... 1/5\n" +
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  status: "pending",
};

const providerStreamRetryAttempt2: TimelineNonOperationSystemRow = {
  id: "thr_ggp8mmze2q:error:5948",
  threadId: "thr_ggp8mmze2q",
  turnId: "019e3439-7692-7691-832f-a015ebaa50f5",
  sourceSeqStart: 5948,
  sourceSeqEnd: 5948,
  startedAt: 1778992963354,
  createdAt: 1778992963354,
  kind: "system",
  systemKind: "reconnect",
  title:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  detail:
    "Reconnecting... 2/5\n" +
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  status: "pending",
};

const providerStreamRetryAttempt3: TimelineNonOperationSystemRow = {
  id: "thr_ggp8mmze2q:error:5949",
  threadId: "thr_ggp8mmze2q",
  turnId: "019e3439-7692-7691-832f-a015ebaa50f5",
  sourceSeqStart: 5949,
  sourceSeqEnd: 5949,
  startedAt: 1778992966974,
  createdAt: 1778992966974,
  kind: "system",
  systemKind: "reconnect",
  title:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  detail:
    "Reconnecting... 3/5\n" +
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  status: "pending",
};

const providerStreamRetryAttempt4: TimelineNonOperationSystemRow = {
  id: "thr_ggp8mmze2q:error:5950",
  threadId: "thr_ggp8mmze2q",
  turnId: "019e3439-7692-7691-832f-a015ebaa50f5",
  sourceSeqStart: 5950,
  sourceSeqEnd: 5950,
  startedAt: 1778992970894,
  createdAt: 1778992970894,
  kind: "system",
  systemKind: "reconnect",
  title:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  detail:
    "Reconnecting... 4/5\n" +
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  status: "pending",
};

const providerStreamRetryAttempt5: TimelineNonOperationSystemRow = {
  id: "thr_ggp8mmze2q:error:5951",
  threadId: "thr_ggp8mmze2q",
  turnId: "019e3439-7692-7691-832f-a015ebaa50f5",
  sourceSeqStart: 5951,
  sourceSeqEnd: 5951,
  startedAt: 1778992975767,
  createdAt: 1778992975767,
  kind: "system",
  systemKind: "reconnect",
  title:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  detail:
    "Reconnecting... 5/5\n" +
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  status: "pending",
};

const providerStreamFinalFailure: TimelineNonOperationSystemRow = {
  id: "thr_ggp8mmze2q:error:5952",
  threadId: "thr_ggp8mmze2q",
  turnId: "019e3439-7692-7691-832f-a015ebaa50f5",
  sourceSeqStart: 5952,
  sourceSeqEnd: 5952,
  startedAt: 1778992981527,
  createdAt: 1778992981527,
  kind: "system",
  systemKind: "error",
  title:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  detail:
    "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)",
  status: "error",
};

const providerChildProcessTimeout: TimelineNonOperationSystemRow = {
  id: "thr_5cs6d5h7gu:error:19450",
  threadId: "thr_5cs6d5h7gu",
  turnId: "019e343a-076f-7a62-ac98-fb36f984b881",
  sourceSeqStart: 19450,
  sourceSeqEnd: 19450,
  startedAt: 1778993228124,
  createdAt: 1778993228124,
  kind: "system",
  systemKind: "reconnect",
  title: "timeout waiting for child process to exit",
  detail: "Reconnecting... 3/5\ntimeout waiting for child process to exit",
  status: "pending",
};

const providerOverloaded: TimelineNonOperationSystemRow = {
  id: "thr_s7nr8hdsyf:error:416",
  threadId: "thr_s7nr8hdsyf",
  turnId: "turn_725060f798c8497a_1",
  sourceSeqStart: 416,
  sourceSeqEnd: 416,
  startedAt: 1778871667729,
  createdAt: 1778871667729,
  kind: "system",
  systemKind: "error",
  title: "API Error: Overloaded",
  detail: "API Error: Overloaded",
  status: "error",
};

const providerRateLimit: TimelineNonOperationSystemRow = {
  id: "thr_axe9q6zfcj:error:48",
  threadId: "thr_axe9q6zfcj",
  turnId: "turn_f7e4049aca264187_1",
  sourceSeqStart: 48,
  sourceSeqEnd: 48,
  startedAt: 1777934876290,
  createdAt: 1777934876290,
  kind: "system",
  systemKind: "error",
  title: "You've hit your limit · resets 7:50pm (America/Los_Angeles)",
  detail: "You've hit your limit · resets 7:50pm (America/Los_Angeles)",
  status: "error",
};

const providerModelUnavailable: TimelineNonOperationSystemRow = {
  id: "thr_u3r2maxtsx:error:10",
  threadId: "thr_u3r2maxtsx",
  turnId: "turn_bc782e4115754eb2_1",
  sourceSeqStart: 10,
  sourceSeqEnd: 10,
  startedAt: 1777871877997,
  createdAt: 1777871877997,
  kind: "system",
  systemKind: "error",
  title:
    "There's an issue with the selected model (opus-4.7). It may not exist or you may not have access to it. Run --model to pick a different model.",
  detail:
    "There's an issue with the selected model (opus-4.7). It may not exist or you may not have access to it. Run --model to pick a different model.",
  status: "error",
};

const systemTurnSubmitTooLarge: TimelineNonOperationSystemRow = {
  id: "thr_wu5sexdwxn:error:2307",
  threadId: "thr_wu5sexdwxn",
  turnId: null,
  sourceSeqStart: 2307,
  sourceSeqEnd: 2307,
  startedAt: 1778610066610,
  createdAt: 1778610066610,
  kind: "system",
  systemKind: "error",
  title: "Command turn.submit failed",
  detail: "Input exceeds the maximum length of 1048576 characters.",
  status: "error",
};

const systemThreadStartModuleMissing: TimelineNonOperationSystemRow = {
  id: "thr_2twyaj9bbg:error:5",
  threadId: "thr_2twyaj9bbg",
  turnId: null,
  sourceSeqStart: 5,
  sourceSeqEnd: 5,
  startedAt: 1778565234271,
  createdAt: 1778565234271,
  kind: "system",
  systemKind: "error",
  title: "Command thread.start failed",
  detail:
    'Provider "claude-code" exited unexpectedly\n' +
    "stderr: node:internal/modules/esm/resolve:274\n" +
    "    throw new ERR_MODULE_NOT_FOUND(\n" +
    "          ^\n" +
    "\n" +
    "Error [ERR_MODULE_NOT_FOUND]: Cannot find module '/Users/michael/Projects/bb/packages/domain/src/shared-types.js' imported from /Users/michael/Projects/bb/packages/domain/src/index.ts\n" +
    "    at finalizeResolution (node:internal/modules/esm/resolve:274:11)\n" +
    "    at moduleResolve (node:internal/modules/esm/resolve:859:10)\n" +
    "    at defaultResolve (node:internal/modules/esm/resolve:983:11)\n" +
    "    at ModuleLoader.defaultReso",
  status: "error",
};

const providerStreamDisconnectRows: TimelineRow[] = [
  providerStreamRetryAttempt1,
  providerStreamRetryAttempt2,
  providerStreamRetryAttempt3,
  providerStreamRetryAttempt4,
  providerStreamRetryAttempt5,
  providerStreamFinalFailure,
];

const providerStreamFinalFailureExpanded = new Set<string>([
  providerStreamFinalFailure.id,
]);
const providerChildProcessTimeoutExpanded = new Set<string>([
  providerChildProcessTimeout.id,
]);
const providerOverloadedExpanded = new Set<string>([providerOverloaded.id]);
const providerRateLimitExpanded = new Set<string>([providerRateLimit.id]);
const providerModelUnavailableExpanded = new Set<string>([
  providerModelUnavailable.id,
]);
const systemTurnSubmitTooLargeExpanded = new Set<string>([
  systemTurnSubmitTooLarge.id,
]);
const systemThreadStartModuleMissingExpanded = new Set<string>([
  systemThreadStartModuleMissing.id,
]);

export function Errors() {
  return (
    <StoryCard>
      <StoryRow
        label="provider/error — reconnect burst"
        hint="willRetry=true rows followed by a final willRetry=false failure; legacy detail supplies the row title"
      >
        <ErrorRowsPreview
          initialExpanded={providerStreamFinalFailureExpanded}
          rows={providerStreamDisconnectRows}
        />
      </StoryRow>
      <StoryRow
        label="provider/error — child process timeout"
        hint="provider retry progress plus host process timeout detail"
      >
        <ErrorRowsPreview
          initialExpanded={providerChildProcessTimeoutExpanded}
          rows={[providerChildProcessTimeout]}
        />
      </StoryRow>
      <StoryRow
        label="provider/error — overloaded"
        hint="short provider failure detail"
      >
        <ErrorRowsPreview
          initialExpanded={providerOverloadedExpanded}
          rows={[providerOverloaded]}
        />
      </StoryRow>
      <StoryRow
        label="provider/error — rate limit"
        hint="provider quota text with reset time"
      >
        <ErrorRowsPreview
          initialExpanded={providerRateLimitExpanded}
          rows={[providerRateLimit]}
        />
      </StoryRow>
      <StoryRow
        label="provider/error — model unavailable"
        hint="selected model does not exist or is inaccessible"
      >
        <ErrorRowsPreview
          initialExpanded={providerModelUnavailableExpanded}
          rows={[providerModelUnavailable]}
        />
      </StoryRow>
      <StoryRow
        label="system/error — turn.submit too large"
        hint="thread command failed before the turn could be submitted"
      >
        <ErrorRowsPreview
          initialExpanded={systemTurnSubmitTooLargeExpanded}
          rows={[systemTurnSubmitTooLarge]}
        />
      </StoryRow>
      <StoryRow
        label="system/error — thread.start crashed"
        hint="daemon command failure with stderr stack trace"
      >
        <ErrorRowsPreview
          initialExpanded={systemThreadStartModuleMissingExpanded}
          rows={[systemThreadStartModuleMissing]}
        />
      </StoryRow>
    </StoryCard>
  );
}
