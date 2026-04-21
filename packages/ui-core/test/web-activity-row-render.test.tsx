import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ViewWebFetchMessage, ViewWebSearchMessage } from "@bb/domain";
import {
  WebFetchRow,
  WebSearchRow,
} from "../src/thread-timeline/rows/WebSearchRow.js";

function buildWebSearchMessage(
  status: ViewWebSearchMessage["status"],
): ViewWebSearchMessage {
  return {
    kind: "web-search",
    id: "web-search-1",
    threadId: "thread-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    createdAt: 1,
    callId: "call-1",
    queries: ["react suspense"],
    resultText: null,
    status,
  };
}

function buildWebFetchMessage(
  status: ViewWebFetchMessage["status"],
): ViewWebFetchMessage {
  return {
    kind: "web-fetch",
    id: "web-fetch-1",
    threadId: "thread-1",
    sourceSeqStart: 1,
    sourceSeqEnd: 1,
    createdAt: 1,
    callId: "call-2",
    url: "https://example.com",
    prompt: null,
    pattern: null,
    resultText: null,
    status,
  };
}

describe("web activity row rendering", () => {
  it("renders searches from queries[0]", () => {
    const html = renderToStaticMarkup(
      <WebSearchRow message={buildWebSearchMessage("completed")} />,
    );

    expect(html).toContain("Searched");
    expect(html).toContain("react suspense");
  });

  it("renders fetch rows with fetch-specific copy", () => {
    const html = renderToStaticMarkup(
      <WebFetchRow message={buildWebFetchMessage("completed")} />,
    );

    expect(html).toContain("Fetched");
    expect(html).toContain("https://example.com");
  });
});
