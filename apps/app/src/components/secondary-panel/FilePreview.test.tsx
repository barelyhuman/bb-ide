// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FilePreview } from "./FilePreview";

type ClipboardWriteText = (text: string) => Promise<void>;

function installClipboardWriteTextMock() {
  const writeText = vi.fn<ClipboardWriteText>();
  writeText.mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  return writeText;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("FilePreview", () => {
  it("copies the absolute path when the preview displays a relative path", async () => {
    const writeText = installClipboardWriteTextMock();

    render(
      <FilePreview
        path="src/App.tsx"
        copyPath="/Users/me/project/src/App.tsx"
        state={{ kind: "loading" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Copy file path" }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("/Users/me/project/src/App.tsx");
    });
  });

  it("renders sanitized HTML in markdown file previews", () => {
    const { container } = render(
      <FilePreview
        path="README.md"
        state={{
          kind: "ready",
          lineNumber: null,
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
