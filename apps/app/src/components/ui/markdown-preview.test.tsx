// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreview } from "@/components/ui/markdown-preview";
import {
  restoreMatchMedia,
  setupMatchMedia,
} from "@/test/helpers/match-media.js";

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
  restoreMatchMedia();
  vi.clearAllMocks();
});

describe("MarkdownPreview", () => {
  it("renders GFM content as Markdown elements", () => {
    render(
      <MarkdownPreview
        content={[
          "# Storage Notes",
          "",
          "- [x] shipped",
          "",
          "| File | State |",
          "| --- | --- |",
          "| notes.md | done |",
        ].join("\n")}
      />,
    );

    expect(screen.getByRole("heading", { name: "Storage Notes" })).toBeTruthy();
    expect(screen.getByRole("table")).toBeTruthy();
    expect(screen.getByText("notes.md")).toBeTruthy();
    expect(screen.getByRole("checkbox")).toBeTruthy();
  });

  it("lets callers intercept local file links without changing other links", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content={[
          "[Open absolute](/workspace/src/app.ts:12)",
          "[Open file URL](file:///workspace/src/file-url.ts#L4)",
          "[Leave relative](apps/app/src/main.tsx#L4)",
          "[Leave bare](README.md)",
          "[Docs](https://example.test)",
        ].join(" ")}
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    fireEvent.click(screen.getByRole("link", { name: "Open absolute" }));
    fireEvent.click(screen.getByRole("link", { name: "Open file URL" }));

    expect(
      screen.getByRole("link", { name: "Open absolute" }).getAttribute("href"),
    ).toBe("file:///workspace/src/app.ts#L12");
    expect(
      screen.getByRole("link", { name: "Leave relative" }).getAttribute("href"),
    ).toBe("apps/app/src/main.tsx#L4");
    expect(
      screen.getByRole("link", { name: "Leave bare" }).getAttribute("href"),
    ).toBe("README.md");
    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(2);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: 12,
      path: "/workspace/src/app.ts",
    });
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: 4,
      path: "/workspace/src/file-url.ts",
    });
  });

  it("does not rewrite local file links without a local file handler", () => {
    render(
      <MarkdownPreview content="[Open absolute](/workspace/src/app.ts:12)" />,
    );

    expect(
      screen.getByRole("link", { name: "Open absolute" }).getAttribute("href"),
    ).toBe("/workspace/src/app.ts:12");
  });

  it("renders thread file links as file URLs while routing clicks through the local file handler", () => {
    const onOpenLocalFileLink = vi.fn(() => true);
    render(
      <MarkdownPreview
        content={
          "[ThreadTimelinePane.tsx](/Users/michael/.bb-dev/worktrees/env_7m3cieyz6q/bb/apps/app/src/views/thread-detail/ThreadTimelinePane.tsx:145)"
        }
        onOpenLocalFileLink={onOpenLocalFileLink}
      />,
    );

    const link = screen.getByRole("link", { name: "ThreadTimelinePane.tsx" });
    expect(link.getAttribute("href")).toBe(
      "file:///Users/michael/.bb-dev/worktrees/env_7m3cieyz6q/bb/apps/app/src/views/thread-detail/ThreadTimelinePane.tsx#L145",
    );

    fireEvent.click(link);

    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineNumber: 145,
      path: "/Users/michael/.bb-dev/worktrees/env_7m3cieyz6q/bb/apps/app/src/views/thread-detail/ThreadTimelinePane.tsx",
    });
  });

  it("renders inline code and block code with copy affordance", () => {
    const writeText = installClipboardWriteTextMock();
    render(
      <MarkdownPreview
        content={[
          "Run `pnpm test` before merging.",
          "",
          "```ts",
          "const value = 1;",
          "```",
        ].join("\n")}
      />,
    );

    expect(screen.getByText("pnpm test").tagName).toBe("CODE");
    expect(screen.getByText("const value = 1;").tagName).toBe("CODE");

    fireEvent.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith("const value = 1;");
  });

  it("opens Markdown images in the lightbox and navigates between them", () => {
    setupMatchMedia();
    render(
      <MarkdownPreview
        content={[
          "![One](https://example.test/one.png)",
          "![Two](https://example.test/two.png)",
        ].join("\n")}
      />,
    );

    fireEvent.click(screen.getByRole("img", { name: "One" }));

    expect(
      screen.getByRole("img", { name: "Expanded image" }).getAttribute("src"),
    ).toBe("https://example.test/one.png");

    fireEvent.click(screen.getByRole("button", { name: "Next image" }));
    expect(
      screen.getByRole("img", { name: "Expanded image" }).getAttribute("src"),
    ).toBe("https://example.test/two.png");

    fireEvent.click(screen.getByRole("button", { name: "Previous image" }));
    expect(
      screen.getByRole("img", { name: "Expanded image" }).getAttribute("src"),
    ).toBe("https://example.test/one.png");
  });
});
