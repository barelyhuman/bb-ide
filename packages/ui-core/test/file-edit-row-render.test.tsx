import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewFileEditMessage } from "@bb/domain";
import { FileEditRow } from "../src/thread-timeline/rows/FileEditRow.js";

function baseMessage(): ViewFileEditMessage {
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
    changes: [
      {
        path: "src/app.ts",
        kind: "update",
        diff: "--- a/src/app.ts\n+++ b/src/app.ts\n-const enabled = false;\n+const enabled = true;\n",
      },
    ],
  };
}

describe("FileEditRow rendering", () => {
  it("renders raw diff text when only a headerless synthetic update diff is available", () => {
    const html = renderToStaticMarkup(
      <FileEditRow message={baseMessage()} initialExpanded={true} />,
    );

    expect(html).toContain("--- a/src/app.ts");
    expect(html).toContain("+++ b/src/app.ts");
    expect(html).toContain("-const enabled = false;");
    expect(html).toContain("+const enabled = true;");
  });
});
