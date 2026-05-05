// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  ManagerTimelineView,
  ThreadTimelineResponse,
  TimelinePaginationCursor,
  TimelineSystemRow,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { threadTimelineLatestQueryKey } from "@/hooks/queries/query-keys";
import * as api from "@/lib/api";
import { useThreadTimelinePages } from "./useThreadTimelinePages";

vi.mock("@/lib/api", () => ({
  getThreadTimeline: vi.fn(),
}));

interface TimelinePageArgs {
  hasOlderRows: boolean;
  kind: ThreadTimelineResponse["timelinePage"]["kind"];
  rows: TimelineSystemRow[];
}

interface TimelineScenario {
  label: string;
  managerTimelineView: ManagerTimelineView | undefined;
}

const SCENARIOS: readonly TimelineScenario[] = [
  { label: "regular standard", managerTimelineView: undefined },
  { label: "manager standard", managerTimelineView: "standard" },
  { label: "manager conversation", managerTimelineView: "conversation" },
];

function rowId(sequence: number): string {
  return `row-${sequence}`;
}

function systemRow(sequence: number): TimelineSystemRow {
  return {
    id: rowId(sequence),
    threadId: "thread-1",
    turnId: null,
    sourceSeqStart: sequence,
    sourceSeqEnd: sequence,
    startedAt: sequence,
    createdAt: sequence,
    kind: "system",
    systemKind: "operation",
    title: `Operation ${sequence}`,
    detail: null,
    status: "completed",
  };
}

function rowsFromRange(start: number, end: number): TimelineSystemRow[] {
  const rows: TimelineSystemRow[] = [];
  for (let sequence = start; sequence <= end; sequence += 1) {
    rows.push(systemRow(sequence));
  }
  return rows;
}

function olderCursorForRows(
  rows: readonly TimelineSystemRow[],
  hasOlderRows: boolean,
): TimelinePaginationCursor | null {
  const oldestRow = rows[0];
  return hasOlderRows && oldestRow
    ? {
        topLevelSortSeq: oldestRow.sourceSeqStart,
        rowId: oldestRow.id,
      }
    : null;
}

function timelineResponse({
  hasOlderRows,
  kind,
  rows,
}: TimelinePageArgs): ThreadTimelineResponse {
  return {
    activeThinking: null,
    rows,
    timelinePage: {
      kind,
      topLevelLimit: 100,
      returnedOlderTopLevelRowCount: rows.length,
      hasOlderRows,
      olderCursor: olderCursorForRows(rows, hasOlderRows),
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useThreadTimelinePages", () => {
  it.each(SCENARIOS)(
    "preserves loaded $label rows when latest refetch advances past the cap",
    async ({ managerTimelineView }) => {
      const firstLatest = timelineResponse({
        hasOlderRows: true,
        kind: "latest",
        rows: rowsFromRange(6, 105),
      });
      const nextLatest = timelineResponse({
        hasOlderRows: true,
        kind: "latest",
        rows: rowsFromRange(7, 106),
      });
      vi.mocked(api.getThreadTimeline).mockResolvedValueOnce(firstLatest);
      const { queryClient, wrapper } = createQueryClientTestHarness();
      const { result } = renderHook(
        () =>
          useThreadTimelinePages({
            managerTimelineView,
            threadId: "thread-1",
          }),
        { wrapper },
      );

      await waitFor(() =>
        expect(result.current.timelineRows).toHaveLength(100),
      );

      act(() => {
        queryClient.setQueryData(
          threadTimelineLatestQueryKey("thread-1", managerTimelineView),
          nextLatest,
        );
      });

      await waitFor(() =>
        expect(result.current.timelineRows).toHaveLength(101),
      );
      expect(result.current.timelineRows[0]?.id).toBe(rowId(6));
      expect(result.current.timelineRows.at(-1)?.id).toBe(rowId(106));
    },
  );

  it("preserves manually loaded older rows when latest refetch advances", async () => {
    const firstLatest = timelineResponse({
      hasOlderRows: true,
      kind: "latest",
      rows: rowsFromRange(6, 105),
    });
    const olderPage = timelineResponse({
      hasOlderRows: false,
      kind: "older",
      rows: rowsFromRange(1, 5),
    });
    const nextLatest = timelineResponse({
      hasOlderRows: true,
      kind: "latest",
      rows: rowsFromRange(7, 106),
    });
    vi.mocked(api.getThreadTimeline)
      .mockResolvedValueOnce(firstLatest)
      .mockResolvedValueOnce(olderPage);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadTimelinePages({
          managerTimelineView: undefined,
          threadId: "thread-1",
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.timelineRows[0]?.id).toBe(rowId(6)),
    );
    await waitFor(() => expect(result.current.hasOlderTimelineRows).toBe(true));
    await act(async () => {
      await result.current.loadOlderTimelineRows();
    });
    expect(result.current.timelineRows[0]?.id).toBe(rowId(1));
    expect(result.current.timelineRows).toHaveLength(105);

    act(() => {
      queryClient.setQueryData(
        threadTimelineLatestQueryKey("thread-1", undefined),
        nextLatest,
      );
    });

    await waitFor(() => expect(result.current.timelineRows).toHaveLength(106));
    expect(result.current.timelineRows[0]?.id).toBe(rowId(1));
    expect(result.current.timelineRows.at(-1)?.id).toBe(rowId(106));
  });

  it("loads the gap first after a latest refetch no longer overlaps loaded rows", async () => {
    const firstLatest = timelineResponse({
      hasOlderRows: true,
      kind: "latest",
      rows: rowsFromRange(51, 150),
    });
    const gapPage = timelineResponse({
      hasOlderRows: true,
      kind: "older",
      rows: rowsFromRange(101, 200),
    });
    const nextLatest = timelineResponse({
      hasOlderRows: true,
      kind: "latest",
      rows: rowsFromRange(201, 300),
    });
    vi.mocked(api.getThreadTimeline)
      .mockResolvedValueOnce(firstLatest)
      .mockResolvedValueOnce(gapPage);
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () =>
        useThreadTimelinePages({
          managerTimelineView: undefined,
          threadId: "thread-1",
        }),
      { wrapper },
    );

    await waitFor(() =>
      expect(result.current.timelineRows[0]?.id).toBe(rowId(51)),
    );

    act(() => {
      queryClient.setQueryData(
        threadTimelineLatestQueryKey("thread-1", undefined),
        nextLatest,
      );
    });

    await waitFor(() =>
      expect(result.current.timelineRows.at(-1)?.id).toBe(rowId(300)),
    );
    await act(async () => {
      await result.current.loadOlderTimelineRows();
    });

    expect(api.getThreadTimeline).toHaveBeenLastCalledWith(
      expect.objectContaining({
        beforeCursor: {
          topLevelSortSeq: 201,
          rowId: rowId(201),
        },
        id: "thread-1",
      }),
    );
    expect(result.current.timelineRows[0]?.id).toBe(rowId(51));
    expect(result.current.timelineRows.at(-1)?.id).toBe(rowId(300));
    expect(result.current.timelineRows).toHaveLength(250);
  });
});
