import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { TimelineToolGroupRow } from "@bb/domain";
import { ThreadTimelineRows } from "../src/thread-timeline/ThreadTimelineRows.js";

function buildToolGroupRow(): TimelineToolGroupRow {
  return {
    kind: "tool-group",
    id: "group-1",
    turnId: "turn-1",
    summaryCount: 3,
    sourceSeqStart: 1,
    sourceSeqEnd: 3,
    startedAt: 1,
    createdAt: 1,
    durationMs: 128_000,
    status: "error",
    messages: [],
  };
}

describe("ThreadTimelineRows rendering", () => {
  it("keeps grouped work summaries neutral even when a child call failed", () => {
    const html = renderToStaticMarkup(
      <ThreadTimelineRows
        latestActivityRowId={null}
        loadingToolGroupIds={new Set()}
        onLoadToolGroupMessages={() => {}}
        threadDetailRows={[buildToolGroupRow()]}
        threadStatus="completed"
        toolGroupMessagesById={{}}
      />,
    );

    expect(html).toContain("Worked for");
    expect(html).not.toContain("text-destructive");
  });
});
