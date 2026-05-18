import type { PromptInput, ThreadRuntimeDisplayStatus } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildAutoFollowUpRequest,
  buildCreateQueuedFollowUpRequest,
  buildQueuedSteerRequests,
  buildSteerFollowUpRequest,
  canSubmitSteerBatch,
  shouldQueueFollowUpMessage,
} from "./threadDetailPromptSubmission";

const textInput: PromptInput[] = [{ type: "text", text: "Follow up" }];

describe("threadDetailPromptSubmission", () => {
  it("builds steer follow-up requests without execution options", () => {
    expect(
      buildSteerFollowUpRequest({
        input: textInput,
        threadId: "thread-1",
      }),
    ).toEqual({
      id: "thread-1",
      input: textInput,
      mode: "steer",
    });
  });

  it("builds queued-message steer requests in queued order", () => {
    expect(
      buildQueuedSteerRequests({
        queuedMessages: [{ id: "queued-1" }, { id: "queued-2" }],
        threadId: "thread-1",
      }),
    ).toEqual([
      {
        id: "thread-1",
        mode: "steer",
        queuedMessageId: "queued-1",
      },
      {
        id: "thread-1",
        mode: "steer",
        queuedMessageId: "queued-2",
      },
    ]);
  });

  it("builds auto follow-up requests with selected execution options", () => {
    expect(
      buildAutoFollowUpRequest({
        input: textInput,
        model: "gpt-5",
        permissionMode: "full",
        reasoningLevel: "medium",
        serviceTier: "default",
        supportsServiceTier: true,
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

  it("omits unsupported service tier when queueing a follow-up", () => {
    expect(
      buildCreateQueuedFollowUpRequest({
        input: textInput,
        model: "gpt-5",
        permissionMode: "workspace-write",
        reasoningLevel: "high",
        serviceTier: "fast",
        supportsServiceTier: false,
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

  it("gates queue and steer submission by runtime state and pending work", () => {
    expect(
      canSubmitSteerBatch({
        hasPromptDraftInput: false,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    expect(
      canSubmitSteerBatch({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: false,
        queuedMessageCount: 0,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(true);
    expect(
      canSubmitSteerBatch({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: true,
        isQueueMutationPending: false,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitSteerBatch({
        hasPromptDraftInput: true,
        isFollowUpSubmitting: false,
        isQueueMutationPending: true,
        queuedMessageCount: 1,
        runtimeDisplayStatus: "active",
        submitModeKind: "queue",
      }),
    ).toBe(false);
    expect(
      canSubmitSteerBatch({
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
