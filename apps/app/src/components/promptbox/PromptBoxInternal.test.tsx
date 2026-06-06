// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@/lib/prompt-draft";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { PromptBoxInternal } from "./PromptBoxInternal";

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

interface PromptBoxHarnessProps {
  autoFocus?: boolean;
  historyEntries: PromptBoxHarnessDraft[];
  initialDraft: PromptBoxHarnessDraft;
  mentionSuggestions?: PromptMentionSuggestion[];
  onChangeSpy?: PromptBoxHarnessChangeSpy;
  onAttachFiles?: (files: File[]) => void | Promise<void>;
  resolveMentionLink?: PromptMentionLinkResolver;
  resetKey?: string | number;
}

type PromptBoxHarnessDraft = Omit<PromptDraftState, "mentions"> & {
  mentions?: PromptDraftState["mentions"];
};

type PromptBoxHarnessChangeSpy = (
  nextText: string,
  nextMentions: PromptDraftState["mentions"],
) => void;

type HistoryArrowKey = "ArrowUp" | "ArrowDown";

interface PressHistoryArrowArgs {
  expectedValue: string;
  key: HistoryArrowKey;
  editor: HTMLElement;
}

interface PressIgnoredHistoryArrowArgs {
  expectedValue: string;
  key: HistoryArrowKey;
  editor: HTMLElement;
}

interface TestClipboardDataArgs {
  files?: File[];
  html?: string;
  text?: string;
}

interface TestClipboardItem {
  kind: "file";
  getAsFile: () => File | null;
}

interface TestClipboardData {
  items: TestClipboardItem[];
  getData: (format: string) => string;
}

function PromptBoxHarness(args: PromptBoxHarnessProps) {
  const [draft, setDraft] = useState<PromptDraftState>(
    normalizeHarnessDraft(args.initialDraft),
  );
  const historyEntries = args.historyEntries.map(normalizeHarnessDraft);

  return (
    <>
      <PromptBoxInternal
        value={draft.text}
        mentionRanges={draft.mentions}
        onChange={(nextText, nextMentions) => {
          args.onChangeSpy?.(nextText, nextMentions);
          setDraft((currentDraft) => ({
            ...currentDraft,
            text: nextText,
            mentions: nextMentions,
          }));
        }}
        onSubmit={() => {}}
        autoFocus={args.autoFocus ?? false}
        attachments={{
          items: draft.attachments,
          onAttachFiles: args.onAttachFiles,
          onRemove: () => {},
        }}
        mentions={{
          suggestions: args.mentionSuggestions ?? [],
          isLoading: false,
          isError: false,
          onQueryChange: () => {},
          resolveLink: args.resolveMentionLink,
        }}
        mentionMenuPlacement="bottom"
        history={{
          currentDraft: draft,
          entries: historyEntries,
          onSelectEntry: setDraft,
          resetKey: args.resetKey ?? "scope-1",
        }}
      />
      <output data-testid="draft-text">{draft.text}</output>
      <output data-testid="draft-mentions">{draft.mentions.length}</output>
    </>
  );
}

function normalizeHarnessDraft(draft: PromptBoxHarnessDraft): PromptDraftState {
  return {
    ...draft,
    mentions: draft.mentions ?? [],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function pressHistoryArrow({
  expectedValue,
  editor,
  key,
}: PressHistoryArrowArgs): Promise<void> {
  const wasNotCanceled = fireEvent.keyDown(editor, { key });
  expect(wasNotCanceled).toBe(false);

  await waitFor(() => {
    expect(getDraftText()).toBe(expectedValue);
  });
}

function pressIgnoredHistoryArrow({
  expectedValue,
  editor,
  key,
}: PressIgnoredHistoryArrowArgs): void {
  const wasNotCanceled = fireEvent.keyDown(editor, {
    key,
  });
  expect(wasNotCanceled).toBe(true);
  expect(getDraftText()).toBe(expectedValue);
}

function getEditor(): HTMLElement {
  return screen.getByRole("textbox");
}

function getDraftText(): string {
  return screen.getByTestId("draft-text").textContent ?? "";
}

function getDraftMentionCount(): number {
  return Number(screen.getByTestId("draft-mentions").textContent ?? "0");
}

function createTestClipboardData({
  files = [],
  html = "",
  text = "",
}: TestClipboardDataArgs): TestClipboardData {
  return {
    items: files.map((file) => ({
      kind: "file",
      getAsFile: () => file,
    })),
    getData: (format) => {
      if (format === "text/html") return html;
      if (format === "text/plain") return text;
      return "";
    },
  };
}

function pasteIntoEditor(
  editor: HTMLElement,
  args: TestClipboardDataArgs,
): boolean {
  return fireEvent.paste(editor, {
    clipboardData: createTestClipboardData(args),
  });
}

function findTextNodeAtOffset(
  root: Node,
  targetOffset: number,
): { node: Node; offset: number } {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let currentOffset = 0;
  let lastTextNode: Node | null = null;
  while (true) {
    const node = walker.nextNode();
    if (!node) break;
    lastTextNode = node;
    const textLength = node.textContent?.length ?? 0;
    if (targetOffset <= currentOffset + textLength) {
      return {
        node,
        offset: targetOffset - currentOffset,
      };
    }
    currentOffset += textLength;
  }

  return {
    node: lastTextNode ?? root,
    offset: lastTextNode?.textContent?.length ?? 0,
  };
}

function setEditorSelection(editor: HTMLElement, offset: number): void {
  editor.focus();
  const target = findTextNodeAtOffset(editor, offset);
  const range = document.createRange();
  range.setStart(target.node, target.offset);
  range.collapse(true);

  const selection = window.getSelection();
  if (!selection) {
    throw new Error("Expected DOM selection");
  }
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe("PromptBoxInternal rich paste", () => {
  it("pastes multiline plain text as text and hard breaks", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      text: "First line\r\nSecond line\rThird line",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe("First line\nSecond line\nThird line");
    });
    expect(editor.querySelector("strong")).toBeNull();
    expect(editor.querySelector("a")).toBeNull();
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("li")).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("pastes rich HTML text/plain fallback as plain text and strips formatting and links", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: '<p>Intro</p><p><strong>Bold</strong> <a href="https://example.com">https://example.com</a></p><ul><li>First item</li><li>Second item</li></ul><p>Next</p>',
      text: "Intro\nBold https://example.com\nFirst item\nSecond item\nNext",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe(
        "Intro\nBold https://example.com\nFirst item\nSecond item\nNext",
      );
    });
    expect(editor.querySelector("strong")).toBeNull();
    expect(editor.querySelector("a")).toBeNull();
    expect(editor.querySelector("[href]")).toBeNull();
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("li")).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("normalizes html-only paragraphs, lists, and pre blocks to plain text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: "<p>Intro</p><ul><li>First item</li><li><strong>Second</strong> item</li></ul><pre><code>const x = 1;\nconsole.log(x);</code></pre>",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe(
        "Intro\n- First item\n- Second item\nconst x = 1;\nconsole.log(x);",
      );
    });
    expect(editor.querySelector("ul")).toBeNull();
    expect(editor.querySelector("li")).toBeNull();
    expect(editor.querySelector("pre")).toBeNull();
    expect(editor.querySelector("code")).toBeNull();
    expect(getDraftMentionCount()).toBe(0);
  });

  it("pastes copied mention pills as serialized text without mention metadata", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      html: '<span data-prompt-mention="true" title="Thread: Design review">Thread: Design review</span>',
      text: "@thread:thr_design",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(getDraftText()).toBe("@thread:thr_design");
    });
    expect(getDraftMentionCount()).toBe(0);
    expect(editor.querySelector('[data-prompt-mention="true"]')).toBeNull();
  });

  it("keeps file paste handling on the attachment path", async () => {
    const onAttachFiles = vi.fn();
    const file = new File(["image"], "screenshot.png", {
      type: "image/png",
    });
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [],
        }}
        historyEntries={[]}
        onAttachFiles={onAttachFiles}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    const wasNotCanceled = pasteIntoEditor(editor, {
      files: [file],
      html: "<p>Ignored rich text</p>",
      text: "Ignored rich text",
    });

    expect(wasNotCanceled).toBe(false);
    await waitFor(() => {
      expect(onAttachFiles).toHaveBeenCalledTimes(1);
    });
    expect(onAttachFiles).toHaveBeenCalledWith([file]);
    expect(getDraftText()).toBe("");
  });
});

describe("PromptBoxInternal mentions", () => {
  it("shows the full path as the hover title for file mention pills", async () => {
    const text = "Open @apps/app/src/App.tsx";
    const token = "@apps/app/src/App.tsx";
    const start = text.indexOf(token);
    render(
      <PromptBoxHarness
        initialDraft={{
          text,
          mentions: [
            {
              start,
              end: start + token.length,
              resource: {
                kind: "path",
                source: "workspace",
                entryKind: "file",
                path: "apps/app/src/App.tsx",
                label: "App.tsx",
              },
            },
          ],
          attachments: [],
        }}
        historyEntries={[]}
      />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("textbox")
          .querySelector('[data-prompt-mention="true"]')
          ?.getAttribute("title"),
      ).toBe("apps/app/src/App.tsx");
    });
  });

  it("opens an inserted mention pill via its resolved link on click", async () => {
    const openThread = vi.fn();
    const resolveMentionLink: PromptMentionLinkResolver = (resource) =>
      resource.kind === "thread" ? () => openThread(resource.threadId) : null;
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Ask @thread:thr_x to review",
          mentions: [
            {
              start: 4,
              end: 17,
              resource: {
                kind: "thread",
                threadId: "thr_x",
                threadType: "standard",
                label: "Design review",
              },
            },
          ],
          attachments: [],
        }}
        historyEntries={[]}
        resolveMentionLink={resolveMentionLink}
      />,
    );

    await waitFor(() => {
      expect(
        screen
          .getByRole("textbox")
          .querySelector('[data-prompt-mention="true"]'),
      ).not.toBeNull();
    });
    const pill = screen
      .getByRole("textbox")
      .querySelector('[data-prompt-mention="true"]');
    if (!pill) {
      throw new Error("Expected a mention pill in the editor");
    }
    expect(
      screen.getByRole("button", {
        name: "Open Thread: Design review",
      }),
    ).toBe(pill);
    fireEvent.click(pill);
    fireEvent.keyDown(pill, { key: "Enter" });
    fireEvent.keyDown(pill, { key: " " });

    expect(openThread).toHaveBeenCalledTimes(3);
    expect(openThread).toHaveBeenCalledWith("thr_x");
  });

  it("hides mention results after applying a mention before existing text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Please check @readme-file and update tests",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "a.md",
            name: "a.md",
            replacement: "a.md",
          },
        ]}
      />,
    );

    const editor = getEditor();
    const mentionEnd = "Please check @readme-file".length;
    setEditorSelection(editor, mentionEnd);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /a\.md/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Please check @a.md and update tests");
    });

    fireEvent.click(editor);

    expect(screen.queryByRole("button", { name: /a\.md/ })).toBeNull();
  });

  it("keeps a mention query dismissed after Escape while the caret stays in range", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Please check @pro",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "src/project.ts",
            name: "project.ts",
            replacement: "src/project.ts",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(
      await screen.findByRole("button", { name: /project\.ts/ }),
    ).toBeTruthy();

    const wasNotCanceled = fireEvent.keyDown(editor, { key: "Escape" });
    expect(wasNotCanceled).toBe(false);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /project\.ts/ })).toBeNull();
    });

    fireEvent.click(editor);

    await waitFor(() => {
      expect(screen.queryByRole("button", { name: /project\.ts/ })).toBeNull();
    });
  });

  it("emits one controlled change when applying a mention", async () => {
    const onChangeSpy = vi.fn();
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Open @src/com",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/components",
            name: "components",
            replacement: "src/components/",
          },
        ]}
        onChangeSpy={onChangeSpy}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /components/,
    });
    onChangeSpy.mockClear();
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Open @src/components/ ");
    });
    expect(onChangeSpy).toHaveBeenCalledTimes(1);
  });

  it("renders mixed thread, workspace path, and thread-storage suggestions", async () => {
    const { container } = render(
      <PromptBoxHarness
        initialDraft={{
          text: "Please check @pro",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "thread",
            path: "thread:thr_project",
            replacement: "thread:thr_project",
            projectId: "proj_current",
            threadId: "thr_project",
            title: "Project planning",
            threadType: "manager",
          },
          {
            kind: "thread",
            path: "thread:thr_standard_project",
            replacement: "thread:thr_standard_project",
            projectId: "proj_other",
            projectName: "Marketing Site",
            threadId: "thr_standard_project",
            title: "Project implementation",
            threadType: "standard",
          },
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "src/project.ts",
            name: "project.ts",
            replacement: "src/project.ts",
          },
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/projects",
            name: "projects",
            replacement: "src/projects/",
          },
          {
            kind: "path",
            source: "thread-storage",
            entryKind: "file",
            path: "notes/project.md",
            name: "project.md",
            replacement: "thread-storage:notes/project.md",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    expect(await screen.findByText("Threads")).toBeTruthy();
    expect(screen.getByText("Workspace")).toBeTruthy();
    expect(screen.getByText("Thread storage")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /^Project planning$/ }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Project implementation/ }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /Marketing Site/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /project\.ts/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /projects/ })).toBeTruthy();
    expect(container.querySelector('[data-icon="UserRound"]')).not.toBeNull();
    expect(
      container.querySelector('[data-icon="MessageSquare"]'),
    ).not.toBeNull();
    expect(container.querySelector('[data-icon="File"]')).not.toBeNull();
    expect(container.querySelector('[data-icon="Folder"]')).not.toBeNull();
    expect(screen.queryByText("Paths")).toBeNull();
    expect(screen.queryByText("Folder")).toBeNull();
  });

  it("inserts workspace folder mentions with trailing slash", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Open @src/com",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "directory",
            path: "src/components",
            name: "components",
            replacement: "src/components/",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /components/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Open @src/components/ ");
    });
  });

  it("inserts thread-storage folder mentions with source-qualified text", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "Use @notes",
          attachments: [],
        }}
        historyEntries={[]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "thread-storage",
            entryKind: "directory",
            path: "notes",
            name: "notes",
            replacement: "thread-storage:notes/",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);

    const mentionButton = await screen.findByRole("button", {
      name: /notes/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(getDraftText()).toBe("Use @thread-storage:notes/ ");
    });
  });
});

describe("PromptBoxInternal history navigation", () => {
  it("recalls the newest history entry when the input is empty", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[
          { text: "latest command", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });
  });

  it("navigates selected history entries at the absolute end and restores the empty draft", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[
          { text: "latest command", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);

    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowDown",
      editor,
    });

    await pressHistoryArrow({
      expectedValue: "",
      key: "ArrowDown",
      editor,
    });
  });

  it("does not intercept ArrowUp for an unselected non-empty draft at the absolute end", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "working draft", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    pressIgnoredHistoryArrow({
      expectedValue: "working draft",
      key: "ArrowUp",
      editor,
    });
  });

  it("does not intercept ArrowUp or ArrowDown for a selected entry unless the caret is at the end", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });

    setEditorSelection(editor, 3);
    pressIgnoredHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      editor,
    });

    setEditorSelection(editor, 3);
    pressIgnoredHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowDown",
      editor,
    });
  });

  it("does not overwrite an attachment-only draft", () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "",
          attachments: [
            {
              type: "localFile",
              path: "/tmp/spec.md",
              name: "spec.md",
              sizeBytes: 42,
              mimeType: "text/markdown",
            },
          ],
        }}
        historyEntries={[{ text: "history command", attachments: [] }]}
      />,
    );

    const editor = getEditor();
    expect(screen.queryByText("spec.md")).not.toBeNull();

    setEditorSelection(editor, 0);
    pressIgnoredHistoryArrow({
      expectedValue: "",
      key: "ArrowUp",
      editor,
    });

    expect(screen.queryByText("spec.md")).not.toBeNull();
  });

  it("gives selected mention-like history entries precedence over mention navigation", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[
          { text: "@rea", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "README.md",
            name: "README.md",
            replacement: "README.md",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "@rea",
      key: "ArrowUp",
      editor,
    });
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    setEditorSelection(editor, getDraftText().length);
    await pressHistoryArrow({
      expectedValue: "",
      key: "ArrowDown",
      editor,
    });

    setEditorSelection(editor, 0);
    await pressHistoryArrow({
      expectedValue: "@rea",
      key: "ArrowUp",
      editor,
    });
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    setEditorSelection(editor, getDraftText().length);
    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      editor,
    });
  });

  it("preserves ordinary mention navigation for typed mention drafts", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "@rea", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        mentionSuggestions={[
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "README.md",
            name: "README.md",
            replacement: "README.md",
          },
          {
            kind: "path",
            source: "workspace",
            entryKind: "file",
            path: "src/App.tsx",
            name: "App.tsx",
            replacement: "src/App.tsx",
          },
        ]}
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    fireEvent.click(editor);
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    const wasNotCanceled = fireEvent.keyDown(editor, { key: "ArrowDown" });
    expect(wasNotCanceled).toBe(false);

    fireEvent.keyDown(editor, { key: "Enter" });

    await waitFor(() => {
      expect(getDraftText()).toBe("@src/App.tsx ");
    });
  });

  it("clears the active history session when the reset key changes", async () => {
    const { rerender } = render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-1"
      />,
    );

    const editor = getEditor();
    setEditorSelection(editor, getDraftText().length);
    await pressHistoryArrow({
      expectedValue: "history command",
      key: "ArrowUp",
      editor,
    });

    rerender(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-2"
      />,
    );

    setEditorSelection(editor, getDraftText().length);
    pressIgnoredHistoryArrow({
      expectedValue: "history command",
      key: "ArrowDown",
      editor,
    });
  });
});
