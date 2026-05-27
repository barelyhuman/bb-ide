// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import type { Thread } from "@bb/domain";
import type {
  CommitActionResponse,
  EnvironmentActionResponse,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  RequestEnvironmentActionMutationLike,
  SendMessageMutationLike,
} from "./threadDetailMutationTypes";
import { useThreadGitActions } from "./useThreadGitActions";

interface CapturedToastProps {
  description?: ReactNode;
  title: ReactNode;
  tone: string;
}

interface CapturedToastOptions {
  id: string;
}

interface SonnerCustomOptions {
  id?: string | number;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

type ClipboardWriteText = (text: string) => Promise<void>;

const sonnerToastState = vi.hoisted(() => {
  const invocations: SonnerCustomToast[] = [];
  return {
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const id =
          typeof options?.id === "string" || typeof options?.id === "number"
            ? String(options.id)
            : fallbackId;
        const toast = {
          options: { id },
          renderToast,
        };
        invocations.push(toast);
        return id;
      },
    ),
    dismiss: vi.fn(),
    invocations,
  };
});

vi.mock("sonner", () => ({
  toast: {
    custom: sonnerToastState.custom,
    dismiss: sonnerToastState.dismiss,
  },
}));

function makeThread(): Thread {
  return {
    archivedAt: null,
    automationId: null,
    createdAt: 1,
    deletedAt: null,
    environmentId: "environment-1",
    id: "thread-1",
    lastReadAt: null,
    latestAttentionAt: 10,
    parentThreadId: null,
    projectId: "project-1",
    providerId: "provider-1",
    status: "idle",
    stopRequestedAt: null,
    title: "Thread title",
    titleFallback: "Thread title",
    type: "standard",
    updatedAt: 10,
  };
}

function makeRequestEnvironmentAction(
  response: EnvironmentActionResponse,
): RequestEnvironmentActionMutationLike {
  return {
    isPending: false,
    mutateAsync: vi.fn(async () => response),
  };
}

function makeSendMessage(): SendMessageMutationLike {
  return {
    isPending: false,
    mutateAsync: vi.fn(async () => undefined),
  };
}

function readToastProps(index: number): CapturedToastProps {
  const invocation = sonnerToastState.invocations[index];
  if (!invocation) {
    throw new Error(`Expected toast invocation at index ${index}.`);
  }
  const element = invocation.renderToast(invocation.options.id);
  if (!isValidElement<CapturedToastProps>(element)) {
    throw new Error("Expected app toast content element.");
  }
  return element.props;
}

function installClipboardWriteTextMock(): ReturnType<
  typeof vi.fn<ClipboardWriteText>
> {
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
  sonnerToastState.invocations.splice(0);
  sonnerToastState.custom.mockClear();
  sonnerToastState.dismiss.mockClear();
});

describe("useThreadGitActions", () => {
  it("uses the intended loading and success copy for Ask agent messages", async () => {
    const sendMessage = makeSendMessage();
    const requestEnvironmentAction = makeRequestEnvironmentAction({
      ok: true,
      action: "commit",
      message: "Committed",
      commitSha: "abcdef1234567890",
      commitSubject: "Update toast copy",
    });
    const { result } = renderHook(() =>
      useThreadGitActions({
        requestEnvironmentAction,
        sendMessage,
      }),
    );

    await act(async () => {
      await result.current.handleAskAgentToFixGitAction({
        input: [{ type: "text", text: "Please fix the commit failure." }],
        threadId: "thread-1",
      });
    });

    expect(readToastProps(0)).toMatchObject({
      tone: "loading",
      title: "Sending message",
    });
    expect(readToastProps(1)).toMatchObject({
      tone: "success",
      title: "Message sent",
    });
    expect(sonnerToastState.invocations[1]?.options.id).toBe("toast-1");
  });

  it("uses the intended loading and success copy for commit actions", async () => {
    const writeText = installClipboardWriteTextMock();
    const response: CommitActionResponse = {
      ok: true,
      action: "commit",
      message: "Committed",
      commitSha: "abcdef1234567890",
      commitSubject: "Update toast copy",
    };
    const requestEnvironmentAction = makeRequestEnvironmentAction(response);
    const sendMessage = makeSendMessage();
    const { result } = renderHook(() =>
      useThreadGitActions({
        requestEnvironmentAction,
        sendMessage,
        thread: makeThread(),
      }),
    );

    await act(async () => {
      await result.current.handleCommitThread();
    });

    expect(readToastProps(0)).toMatchObject({
      tone: "loading",
      title: "Creating commit",
    });
    expect(readToastProps(1)).toMatchObject({
      tone: "success",
      title: "Commit created",
    });
    expect(sonnerToastState.invocations[1]?.options.id).toBe("toast-1");

    render(<>{readToastProps(1).description}</>);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy commit SHA abcdef1" }),
    );

    expect(writeText).toHaveBeenCalledWith("abcdef1234567890");
  });

  it("uses the intended loading and success copy for squash merge actions", async () => {
    const writeText = installClipboardWriteTextMock();
    const response: SquashMergeActionResponse = {
      ok: true,
      action: "squash_merge",
      merged: true,
      message: "Squash merged",
      commitSha: "1234567890abcdef",
      commitSubject: "Squash branch changes",
    };
    const requestEnvironmentAction = makeRequestEnvironmentAction(response);
    const sendMessage = makeSendMessage();
    const { result } = renderHook(() =>
      useThreadGitActions({
        requestEnvironmentAction,
        sendMessage,
        thread: makeThread(),
      }),
    );

    await act(async () => {
      await result.current.handleSquashMergeThread({
        mergeBaseBranch: "main",
      });
    });

    expect(readToastProps(0)).toMatchObject({
      tone: "loading",
      title: "Squash merging",
    });
    expect(readToastProps(1)).toMatchObject({
      tone: "success",
      title: "Squash merge completed",
    });
    expect(sonnerToastState.invocations[1]?.options.id).toBe("toast-1");

    render(<>{readToastProps(1).description}</>);
    fireEvent.click(
      screen.getByRole("button", { name: "Copy commit SHA 1234567" }),
    );

    expect(writeText).toHaveBeenCalledWith("1234567890abcdef");
  });
});
