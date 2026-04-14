import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewToolCallMessage } from "@bb/domain";
import { ToolCallRow } from "../src/thread-timeline/rows/ToolCallRow.js";

function buildToolCallMessage(
  status: ViewToolCallMessage["status"],
): ViewToolCallMessage {
  return {
    kind: "tool-call",
    id: "tool-1",
    threadId: "thread-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    createdAt: 1,
    toolName: "exec_command",
    callId: "call-1",
    command: "echo hello",
    approvalStatus: null,
    status,
  };
}

describe("ToolCallRow rendering", () => {
  it("labels interrupted commands as interrupted, not declined", () => {
    const html = renderToStaticMarkup(
      <ToolCallRow message={buildToolCallMessage("interrupted")} />,
    );

    expect(html).toContain("Interrupted");
    expect(html).not.toContain("Declined");
  });
});
