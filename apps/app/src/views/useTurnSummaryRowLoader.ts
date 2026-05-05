import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type {
  ManagerTimelineView,
  TimelineRow,
  TimelineTurnRow,
  TimelineTurnSummaryDetailsRequest,
  TimelineTurnSummaryDetailsResponse,
} from "@bb/server-contract";
import { shouldLoadNestedRows } from "./turnSummaryRowLoaderHelpers";

export interface LoadTurnSummaryRowsArgs
  extends TimelineTurnSummaryDetailsRequest {
  id: string;
}

export type LoadTurnSummaryRows = (
  args: LoadTurnSummaryRowsArgs,
) => Promise<TimelineTurnSummaryDetailsResponse>;

interface UseTurnSummaryRowLoaderParams {
  managerTimelineView: ManagerTimelineView | undefined;
  threadId?: string;
  loadTurnSummaryRows: LoadTurnSummaryRows;
}

type TurnSummaryRowsById = Record<string, TimelineRow[]>;

export function useTurnSummaryRowLoader({
  loadTurnSummaryRows,
  managerTimelineView,
  threadId,
}: UseTurnSummaryRowLoaderParams) {
  const loadGenerationRef = useRef(0);
  const [loadingTurnSummaryIds, setLoadingTurnSummaryIds] = useState<
    Set<string>
  >(new Set());
  const loadingTurnSummaryIdsRef = useRef(loadingTurnSummaryIds);
  const [erroredTurnSummaryIds, setErroredTurnSummaryIds] = useState<
    Set<string>
  >(new Set());
  const erroredTurnSummaryIdsRef = useRef(erroredTurnSummaryIds);
  const [turnSummaryRowsById, setTurnSummaryRowsById] =
    useState<TurnSummaryRowsById>({});
  const turnSummaryRowsByIdRef = useRef(turnSummaryRowsById);
  const loadTurnSummaryRowsRef = useRef(loadTurnSummaryRows);
  const threadIdRef = useRef(threadId);

  useLayoutEffect(() => {
    loadTurnSummaryRowsRef.current = loadTurnSummaryRows;
  }, [loadTurnSummaryRows]);

  useLayoutEffect(() => {
    threadIdRef.current = threadId;
  }, [threadId]);

  const handleLoadTurnSummaryRows = useCallback((entry: TimelineTurnRow) => {
    const currentThreadId = threadIdRef.current;
    const loadGeneration = loadGenerationRef.current;

    if (
      !shouldLoadNestedRows({
        cachedRowCount:
          turnSummaryRowsByIdRef.current[entry.id]?.length ?? 0,
        inlineRowCount: entry.children?.length ?? 0,
        isLoading: loadingTurnSummaryIdsRef.current.has(entry.id),
        threadId: currentThreadId,
      })
    ) {
      return;
    }
    if (!currentThreadId) {
      return;
    }

    const nextLoadingTurnSummaryIds = new Set(
      loadingTurnSummaryIdsRef.current,
    ).add(entry.id);
    loadingTurnSummaryIdsRef.current = nextLoadingTurnSummaryIds;
    setLoadingTurnSummaryIds(nextLoadingTurnSummaryIds);

    if (erroredTurnSummaryIdsRef.current.has(entry.id)) {
      const nextErroredTurnSummaryIds = new Set(
        erroredTurnSummaryIdsRef.current,
      );
      nextErroredTurnSummaryIds.delete(entry.id);
      erroredTurnSummaryIdsRef.current = nextErroredTurnSummaryIds;
      setErroredTurnSummaryIds(nextErroredTurnSummaryIds);
    }

    void loadTurnSummaryRowsRef
      .current({
        id: currentThreadId,
        turnId: entry.turnId,
        sourceSeqStart: entry.sourceSeqStart,
        sourceSeqEnd: entry.sourceSeqEnd,
      })
      .then((response) => {
        if (loadGenerationRef.current !== loadGeneration) {
          return;
        }
        const nextTurnSummaryRowsById = {
          ...turnSummaryRowsByIdRef.current,
          [entry.id]: response.rows,
        };
        turnSummaryRowsByIdRef.current = nextTurnSummaryRowsById;
        setTurnSummaryRowsById(nextTurnSummaryRowsById);
      })
      .catch(() => {
        if (loadGenerationRef.current !== loadGeneration) {
          return;
        }
        const nextErroredTurnSummaryIds = new Set(
          erroredTurnSummaryIdsRef.current,
        ).add(entry.id);
        erroredTurnSummaryIdsRef.current = nextErroredTurnSummaryIds;
        setErroredTurnSummaryIds(nextErroredTurnSummaryIds);
      })
      .finally(() => {
        if (loadGenerationRef.current !== loadGeneration) {
          return;
        }
        const nextLoadingTurnSummaryIds = new Set(
          loadingTurnSummaryIdsRef.current,
        );
        nextLoadingTurnSummaryIds.delete(entry.id);
        loadingTurnSummaryIdsRef.current = nextLoadingTurnSummaryIds;
        setLoadingTurnSummaryIds(nextLoadingTurnSummaryIds);
      });
  }, []);

  useLayoutEffect(() => {
    loadGenerationRef.current += 1;
    const nextLoadingTurnSummaryIds = new Set<string>();
    const nextErroredTurnSummaryIds = new Set<string>();
    const nextTurnSummaryRowsById: TurnSummaryRowsById = {};
    loadingTurnSummaryIdsRef.current = nextLoadingTurnSummaryIds;
    erroredTurnSummaryIdsRef.current = nextErroredTurnSummaryIds;
    turnSummaryRowsByIdRef.current = nextTurnSummaryRowsById;
    setLoadingTurnSummaryIds(nextLoadingTurnSummaryIds);
    setErroredTurnSummaryIds(nextErroredTurnSummaryIds);
    setTurnSummaryRowsById(nextTurnSummaryRowsById);
  }, [managerTimelineView, threadId]);

  return {
    erroredTurnSummaryIds,
    handleLoadTurnSummaryRows,
    loadingTurnSummaryIds,
    turnSummaryRowsById,
  };
}
