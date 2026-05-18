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
import { PromptBoxInternal } from "./PromptBoxInternal";

vi.mock("@/hooks/useAutoGrow", () => ({
  useAutoGrow: () => () => {},
}));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

interface PromptBoxHarnessProps {
  autoFocus?: boolean;
  historyEntries: PromptDraftState[];
  initialDraft: PromptDraftState;
  mentionSuggestions?: PromptMentionSuggestion[];
  resetKey?: string | number;
}

type HistoryArrowKey = "ArrowUp" | "ArrowDown";

interface PressHistoryArrowArgs {
  expectedValue: string;
  key: HistoryArrowKey;
  textarea: HTMLTextAreaElement;
}

interface PressIgnoredHistoryArrowArgs {
  expectedValue: string;
  key: HistoryArrowKey;
  textarea: HTMLTextAreaElement;
}

function PromptBoxHarness(args: PromptBoxHarnessProps) {
  const [draft, setDraft] = useState(args.initialDraft);

  return (
    <PromptBoxInternal
      value={draft.text}
      onChange={(nextText) => {
        setDraft((currentDraft) => ({
          ...currentDraft,
          text: nextText,
        }));
      }}
      onSubmit={() => {}}
      autoFocus={args.autoFocus ?? false}
      attachments={{
        items: draft.attachments,
        onRemove: () => {},
      }}
      mentions={{
        suggestions: args.mentionSuggestions ?? [],
        isLoading: false,
        isError: false,
        onQueryChange: () => {},
      }}
      mentionMenuPlacement="bottom"
      history={{
        currentDraft: draft,
        entries: args.historyEntries,
        onSelectEntry: setDraft,
        resetKey: args.resetKey ?? "scope-1",
      }}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function pressHistoryArrow({
  expectedValue,
  key,
  textarea,
}: PressHistoryArrowArgs): Promise<void> {
  const wasNotCanceled = fireEvent.keyDown(textarea, { key });
  expect(wasNotCanceled).toBe(false);

  await waitFor(() => {
    expect(textarea.value).toBe(expectedValue);
    expect(textarea.selectionStart).toBe(textarea.value.length);
    expect(textarea.selectionEnd).toBe(textarea.value.length);
  });
}

function pressIgnoredHistoryArrow({
  expectedValue,
  key,
  textarea,
}: PressIgnoredHistoryArrowArgs): void {
  const wasNotCanceled = fireEvent.keyDown(textarea, {
    key,
  });
  expect(wasNotCanceled).toBe(true);
  expect(textarea.value).toBe(expectedValue);
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      resolve();
    });
  });
}

describe("PromptBoxInternal mentions", () => {
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
            kind: "file",
            path: "a.md",
            replacement: "a.md",
          },
        ]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    const mentionEnd = "Please check @readme-file".length;
    textarea.focus();
    textarea.setSelectionRange(mentionEnd, mentionEnd);
    fireEvent.click(textarea);

    const mentionButton = await screen.findByRole("button", {
      name: /a\.md/,
    });
    fireEvent.mouseDown(mentionButton);
    await waitForAnimationFrame();

    await waitFor(() => {
      expect(textarea.value).toBe("Please check @a.md and update tests");
      expect(textarea.selectionStart).toBe("Please check @a.md".length);
      expect(textarea.selectionEnd).toBe("Please check @a.md".length);
    });

    fireEvent.click(textarea);

    expect(screen.queryByRole("button", { name: /a\.md/ })).toBeNull();
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

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      textarea,
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

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);

    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      textarea,
    });

    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      textarea,
    });

    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      textarea,
    });

    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowDown",
      textarea,
    });

    await pressHistoryArrow({
      expectedValue: "",
      key: "ArrowDown",
      textarea,
    });
  });

  it("does not intercept ArrowUp for an unselected non-empty draft at the absolute end", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "working draft", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    pressIgnoredHistoryArrow({
      expectedValue: "working draft",
      key: "ArrowUp",
      textarea,
    });
  });

  it("does not intercept ArrowUp or ArrowDown for a selected entry unless the caret is at the end", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    await pressHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      textarea,
    });

    textarea.setSelectionRange(3, 3);
    pressIgnoredHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowUp",
      textarea,
    });

    textarea.setSelectionRange(3, 3);
    pressIgnoredHistoryArrow({
      expectedValue: "latest command",
      key: "ArrowDown",
      textarea,
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

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(screen.queryByText("spec.md")).not.toBeNull();

    textarea.setSelectionRange(0, 0);
    pressIgnoredHistoryArrow({
      expectedValue: "",
      key: "ArrowUp",
      textarea,
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
            kind: "file",
            path: "README.md",
            replacement: "README.md",
          },
        ]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    await pressHistoryArrow({
      expectedValue: "@rea",
      key: "ArrowUp",
      textarea,
    });
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await pressHistoryArrow({
      expectedValue: "",
      key: "ArrowDown",
      textarea,
    });

    textarea.setSelectionRange(0, 0);
    await pressHistoryArrow({
      expectedValue: "@rea",
      key: "ArrowUp",
      textarea,
    });
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await pressHistoryArrow({
      expectedValue: "older command",
      key: "ArrowUp",
      textarea,
    });
  });

  it("preserves ordinary mention navigation for typed mention drafts", async () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "@rea", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        mentionSuggestions={[
          {
            kind: "file",
            path: "README.md",
            replacement: "README.md",
          },
          {
            kind: "file",
            path: "src/App.tsx",
            replacement: "src/App.tsx",
          },
        ]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.focus();
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.click(textarea);
    await waitFor(() => {
      expect(screen.queryByText("README.md")).not.toBeNull();
    });

    const wasNotCanceled = fireEvent.keyDown(textarea, { key: "ArrowDown" });
    expect(wasNotCanceled).toBe(false);

    fireEvent.keyDown(textarea, { key: "Enter" });

    await waitFor(() => {
      expect(textarea.value).toBe("@src/App.tsx ");
      expect(textarea.selectionStart).toBe(textarea.value.length);
      expect(textarea.selectionEnd).toBe(textarea.value.length);
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

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    await pressHistoryArrow({
      expectedValue: "history command",
      key: "ArrowUp",
      textarea,
    });

    rerender(
      <PromptBoxHarness
        initialDraft={{ text: "", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-2"
      />,
    );

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    pressIgnoredHistoryArrow({
      expectedValue: "history command",
      key: "ArrowDown",
      textarea,
    });
  });
});
