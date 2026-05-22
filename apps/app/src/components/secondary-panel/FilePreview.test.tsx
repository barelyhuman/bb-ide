// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FilePreview", () => {
  it("renders sanitized HTML in markdown file previews", () => {
    const { container } = render(
      <FilePreview
        path="README.md"
        state={{
          kind: "ready",
          lineNumber: null,
          showMarkdownModeToggle: true,
          file: {
            name: "README.md",
            contents: [
              "# Readme",
              "",
              "<kbd>Cmd</kbd>",
              '<div onmouseover="alert(1)">Body</div>',
              "<script>alert(1)</script>",
            ].join("\n"),
          },
        }}
      />,
    );

    expect(screen.getByText("Cmd")).toBeTruthy();
    expect(screen.getByText("Body").getAttribute("onmouseover")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(screen.queryByText("alert(1)")).toBeNull();
  });
});
