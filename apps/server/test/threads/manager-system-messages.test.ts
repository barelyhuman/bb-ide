import type { Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildManagerSystemInput,
  buildManagerSystemThreadMention,
} from "../../src/services/threads/manager-system-messages.js";

function testThread(): Thread {
  return {
    id: "thr_backend_validation",
    projectId: "proj_alpha",
    environmentId: "env_alpha",
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: "Backend validation",
    titleFallback: "Backend validation",
    status: "idle",
    parentThreadId: "thr_manager",
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe("manager system messages", () => {
  it("builds prompt input mentions from serialized rendered tokens", () => {
    const thread = testThread();
    const mention = buildManagerSystemThreadMention({ thread });
    const text = `Assigned ${mention.serializedText} (${thread.title}).`;

    const input = buildManagerSystemInput({
      text,
      mentions: [mention],
    });

    expect(input).toEqual([
      {
        type: "text",
        text,
        mentions: [
          {
            start: "Assigned ".length,
            end: `Assigned ${mention.serializedText}`.length,
            resource: {
              kind: "thread",
              label: "Backend validation",
              projectId: "proj_alpha",
              threadId: "thr_backend_validation",
              threadType: "standard",
            },
          },
        ],
      },
    ]);
  });

  it("rejects mention metadata when the rendered token is absent", () => {
    const mention = buildManagerSystemThreadMention({ thread: testThread() });

    expect(() =>
      buildManagerSystemInput({
        text: "No thread token here.",
        mentions: [mention],
      }),
    ).toThrow("Manager system mention text was not found in message");
  });
});
