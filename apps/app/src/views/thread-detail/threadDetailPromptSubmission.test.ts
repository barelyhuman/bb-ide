import type { PromptInput, ThreadRuntimeDisplayStatus } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildAutoFollowUpRequest,
  buildCreateQueuedFollowUpRequest,
  buildFollowUpShortcutRequest,
  canSubmitFollowUpShortcut,
  resolveDefaultExecutionOptionsState,
  shouldQueueFollowUpMessage,
} from "./threadDetailPromptSubmission";

const textInput: PromptInput[] = [{ type: "text", text: "Follow up" }];

describe("threadDetailPromptSubmission", () => {
  it("prioritizes current prompt input over queued messages for the follow-up shortcut", () => {
    expect(
      buildFollowUpShortcutRequest({
        input: textInput,
        queuedMessages: [{ id: "queued-1" }, { id: "queued-2" }],
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "draft",
      request: {
        id: "thread-1",
        input: textInput,
        mode: "steer",
      },
    });
  });

  it("uses only the next queued message for an empty follow-up shortcut", () => {
    expect(
      buildFollowUpShortcutRequest({
        input: [],
        queuedMessages: [{ id: "queued-1" }, { id: "queued-2" }],
        threadId: "thread-1",
      }),
    ).toEqual({
      kind: "queued",
      request: {
        id: "thread-1",
        mode: "auto",
        queuedMessageId: "queued-1",
      },
    });
  });

  it("does not build an empty follow-up shortcut without queued messages", () => {
    expect(
      buildFollowUpShortcutRequest({
        input: [],
        queuedMessages: [],
        threadId: "thread-1",
      }),
    ).toBeNull();
  });

  it("builds auto follow-up requests with selected execution options", () => {
    expect(
      buildAutoFollowUpRequest({
        execution: {
          model: "gpt-5",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
          supportsServiceTier: true,
        },
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      mode: "auto",
      model: "gpt-5",
      permissionMode: "full",
      reasoningLevel: "medium",
      serviceTier: "default",
    });
  });

  it("omits execution overrides when building auto follow-up requests without concrete defaults", () => {
    expect(
      buildAutoFollowUpRequest({
        execution: null,
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      mode: "auto",
    });
  });

  it("omits unsupported service tier when queueing a follow-up", () => {
    expect(
      buildCreateQueuedFollowUpRequest({
        execution: {
          model: "gpt-5",
          permissionMode: "workspace-write",
          reasoningLevel: "high",
          serviceTier: "fast",
          supportsServiceTier: false,
        },
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      model: "gpt-5",
      permissionMode: "workspace-write",
      reasoningLevel: "high",
    });
  });

  it("omits execution overrides when queueing a follow-up without concrete defaults", () => {
    expect(
      buildCreateQueuedFollowUpRequest({
        execution: null,
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
    });
  });

  it("treats default execution options errors as unavailable rather than loading", () => {
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: true,
        hasResolvedDefaultExecutionOptions: true,
        isError: false,
      }),
    ).toBe("available");
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: false,
        hasResolvedDefaultExecutionOptions: false,
        isError: false,
      }),
    ).toBe("loading");
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: false,
        hasResolvedDefaultExecutionOptions: false,
        isError: true,
      }),
    ).toBe("unavailable");
    expect(
      resolveDefaultExecutionOptionsState({
        hasConcreteDefaultExecutionOptions: false,
        hasResolvedDefaultExecutionOptions: true,
        isError: false,
      }),
    ).toBe("unavailable");
  });

  it("gates the follow-up shortcut by runtime state and pending work", () => {
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: false,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 0,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: true,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: true,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitFollowUpShortcut({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 0,
        runtimeDisplayStatus: "idle",
        submitModeKind: "ready",
      }),
    ).toBe(false);

    const queueableStatuses: ThreadRuntimeDisplayStatus[] = [
      "active",
      "host-reconnecting",
    ];
    const immediateStatuses: ThreadRuntimeDisplayStatus[] = [
      "created",
      "error",
      "idle",
      "provisioning",
      "waiting-for-host",
    ];

    for (const status of queueableStatuses) {
      expect(shouldQueueFollowUpMessage(status)).toBe(true);
    }
    for (const status of immediateStatuses) {
      expect(shouldQueueFollowUpMessage(status)).toBe(false);
    }
  });
});
