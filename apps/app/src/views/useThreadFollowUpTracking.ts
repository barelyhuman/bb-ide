import { useCallback, useEffect, useState } from "react";
import type { PromptInput, TimelineRow } from "@bb/domain";
import type { PromptDraftState } from "@/lib/prompt-draft";
import {
  buildFollowUpSignatureFromInput,
  buildFollowUpSignatureFromRow,
} from "@/lib/thread-follow-up-signature";

interface PendingSubmittedFollowUp {
  draft: PromptDraftState;
  signature: string;
  submittedAt: number;
}

interface UseThreadFollowUpTrackingParams {
  threadDetailRows: TimelineRow[];
  threadId?: string;
  onAcknowledged: (draft: PromptDraftState) => void;
}

interface BeginPendingFollowUpParams {
  draft: PromptDraftState;
  input: PromptInput[];
}

type BeginPendingFollowUp = (params: BeginPendingFollowUpParams) => void;
type ClearPendingFollowUp = () => void;

export function useThreadFollowUpTracking({
  threadDetailRows,
  threadId,
  onAcknowledged,
}: UseThreadFollowUpTrackingParams) {
  const [pendingSubmittedFollowUp, setPendingSubmittedFollowUp] =
    useState<PendingSubmittedFollowUp | null>(null);

  useEffect(() => {
    setPendingSubmittedFollowUp(null);
  }, [threadId]);

  useEffect(() => {
    if (!pendingSubmittedFollowUp) {
      return;
    }

    const acknowledged = threadDetailRows.some((row) => {
      const rowSignature = buildFollowUpSignatureFromRow(row);
      if (rowSignature !== pendingSubmittedFollowUp.signature) {
        return false;
      }

      return (
        row.kind === "message" &&
        row.message.createdAt + 2_000 >= pendingSubmittedFollowUp.submittedAt
      );
    });

    if (!acknowledged) {
      return;
    }

    onAcknowledged(pendingSubmittedFollowUp.draft);
    setPendingSubmittedFollowUp(null);
  }, [onAcknowledged, pendingSubmittedFollowUp, threadDetailRows]);

  const beginPendingFollowUp: BeginPendingFollowUp = useCallback(({ draft, input }) => {
    setPendingSubmittedFollowUp({
      draft,
      signature: buildFollowUpSignatureFromInput(input),
      submittedAt: Date.now(),
    });
  }, []);

  const clearPendingFollowUp: ClearPendingFollowUp = useCallback(() => {
    setPendingSubmittedFollowUp(null);
  }, []);

  return {
    beginPendingFollowUp,
    clearPendingFollowUp,
    pendingSubmittedFollowUp,
  };
}
