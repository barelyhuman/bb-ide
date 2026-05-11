// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Thread } from "@bb/domain";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  baseProps,
  makeThread,
} from "./ThreadMetadataContent.fixtures";
import { ThreadMetadataContent } from "./ThreadMetadataContent";

function renderMetadataContent(thread: Thread) {
  return <ThreadMetadataContent {...baseProps} thread={thread} />;
}

afterEach(() => {
  cleanup();
});

describe("ThreadMetadataContent", () => {
  it("keeps row hook ordering stable when thread type changes mid-mount", () => {
    const { wrapper } = createQueryClientTestHarness();
    const managerThread = makeThread({ type: "manager" });
    const standardThread = makeThread({ type: "standard" });

    const view = render(renderMetadataContent(managerThread), { wrapper });

    expect(screen.getByText("Kind")).toBeTruthy();

    expect(() => {
      view.rerender(renderMetadataContent(standardThread));
    }).not.toThrow();

    expect(screen.getByText("Merge base")).toBeTruthy();
    expect(screen.getByText("None")).toBeTruthy();

    expect(() => {
      view.rerender(renderMetadataContent(managerThread));
    }).not.toThrow();

    expect(screen.getByText("Kind")).toBeTruthy();
  });
});
