import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewFileEditMessage } from "@bb/domain";
import { FileEditRow } from "../src/thread-timeline/rows/FileEditRow.js";

function buildMessage(
  change: ViewFileEditMessage["changes"][number],
): ViewFileEditMessage {
  return {
    kind: "file-edit",
    id: "file-edit-1",
    threadId: "thread-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    createdAt: 1,
    startedAt: 1,
    turnId: "turn-1",
    callId: "edit-1",
    status: "completed",
    changes: [change],
  };
}

describe("FileEditRow rendering", () => {
  it("renders headerless update diffs through PatchDiff without line numbers", () => {
    const html = renderToStaticMarkup(
      <FileEditRow
        message={buildMessage({
          path: "src/app.ts",
          kind: "update",
          diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-const enabled = false;\n+const enabled = true;\n",
        })}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("<diffs-container");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("--- a/src/app.ts");
    expect(html).not.toContain("+++ b/src/app.ts");
  });

  it("renders synthetic created-file diffs without exposing patch metadata", () => {
    const html = renderToStaticMarkup(
      <FileEditRow
        message={buildMessage({
          path: "src/new-file.ts",
          kind: "add",
          diff: "--- /dev/null\n+++ b/src/new-file.ts\n+export const enabled = true;\n",
        })}
        initialExpanded={true}
      />,
    );

    expect(html).toContain("<diffs-container");
    expect(html).not.toContain("<pre");
    expect(html).not.toContain("--- /dev/null");
    expect(html).not.toContain("+++ b/src/new-file.ts");
  });
});
