// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { PromptDraftState } from "@/lib/prompt-draft";
import type { PromptMentionSuggestion } from "@/hooks/usePromptMentions";
import { PromptBox } from "./PromptBox";

vi.mock("@/hooks/useAutoGrow", () => ({
  useAutoGrow: () => () => {},
}));

vi.mock("@/hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    cancel: vi.fn(),
    errorMessage: null,
    isProcessing: false,
    isRecording: false,
    isSupported: false,
    start: vi.fn(),
    state: "idle",
    statusLabel: null,
    stop: vi.fn(),
  }),
}));

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
});

interface PromptBoxHarnessProps {
  historyEntries: PromptDraftState[];
  initialDraft: PromptDraftState;
  mentionSuggestions?: PromptMentionSuggestion[];
  resetKey?: string | number;
}

function PromptBoxHarness(args: PromptBoxHarnessProps) {
  const [draft, setDraft] = useState(args.initialDraft);

  return (
    <PromptBox
      value={draft.text}
      onChange={(nextText) => {
        setDraft((currentDraft) => ({
          ...currentDraft,
          text: nextText,
        }));
      }}
      onSubmit={() => {}}
      attachments={{
        items: draft.attachments,
        onRemove: () => {},
      }}
      mentions={{
        suggestions: args.mentionSuggestions ?? [],
        onQueryChange: () => {},
      }}
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

describe("PromptBox history navigation", () => {
  it("recalls the newest history entry from the start of the input", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "working draft", attachments: [] }}
        historyEntries={[
          { text: "latest command", attachments: [] },
          { text: "older command", attachments: [] },
        ]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(textarea.value).toBe("latest command");

    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(textarea.value).toBe("older command");

    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(textarea.value).toBe("older command");
  });

  it("does not intercept ArrowUp when the caret is mid-input", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "working draft", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(3, 3);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(textarea.value).toBe("working draft");
  });

  it("does not intercept ArrowUp when there is no history to recall", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "working draft", attachments: [] }}
        historyEntries={[]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(textarea.value).toBe("working draft");
  });

  it("restores the temporary draft, including attachments, on ArrowDown", () => {
    render(
      <PromptBoxHarness
        initialDraft={{
          text: "temporary draft",
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
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("history command");

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    expect(textarea.value).toBe("temporary draft");
    expect(screen.queryByText("spec.md")).not.toBeNull();
  });

  it("does not intercept ArrowDown unless the caret is at the end", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "temporary draft", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("history command");

    textarea.setSelectionRange(3, 3);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    expect(textarea.value).toBe("history command");
  });

  it("does not intercept ArrowDown without an active history selection", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "temporary draft", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    expect(textarea.value).toBe("temporary draft");
  });

  it("keeps mention navigation ahead of history navigation", () => {
    render(
      <PromptBoxHarness
        initialDraft={{ text: "@rea", attachments: [] }}
        historyEntries={[{ text: "latest command", attachments: [] }]}
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
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.select(textarea);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });

    expect(textarea.value).toBe("@rea");
  });

  it("clears the active history session when the reset key changes", () => {
    const { rerender } = render(
      <PromptBoxHarness
        initialDraft={{ text: "temporary draft", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-1"
      />,
    );

    const textarea = screen.getByRole<HTMLTextAreaElement>("textbox");
    textarea.setSelectionRange(0, 0);
    fireEvent.keyDown(textarea, { key: "ArrowUp" });
    expect(textarea.value).toBe("history command");

    rerender(
      <PromptBoxHarness
        initialDraft={{ text: "temporary draft", attachments: [] }}
        historyEntries={[{ text: "history command", attachments: [] }]}
        resetKey="scope-2"
      />,
    );

    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    fireEvent.keyDown(textarea, { key: "ArrowDown" });

    expect(textarea.value).toBe("history command");
  });
});
