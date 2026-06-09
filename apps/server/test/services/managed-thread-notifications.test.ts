import type { Thread } from "@bb/domain";
import { describe, expect, it } from "vitest";
import {
  buildManagedThreadTurnStatusBatchInput,
  renderManagedThreadTurnStatusBatchMessage,
} from "../../src/services/threads/managed-thread-notifications.js";

interface TestThreadArgs {
  id: string;
  title: string | null;
}

function testThread(args: TestThreadArgs): Thread {
  return {
    id: args.id,
    projectId: "proj_alpha",
    environmentId: "env_alpha",
    automationId: null,
    providerId: "codex",
    type: "standard",
    title: args.title,
    titleFallback: args.title,
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

describe("managed thread notifications", () => {
  it("preserves manual-stop safety guidance for interrupted batched outcomes", () => {
    const message = renderManagedThreadTurnStatusBatchMessage({
      items: [
        {
          managedThread: testThread({
            id: "thr_child",
            title: "Fix checkout flow",
          }),
          turnStatus: "interrupted",
        },
      ],
    });

    expect(message).toContain(
      "interrupted: @thread:thr_child (Fix checkout flow)",
    );
    expect(message).toContain(
      "If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
    );
  });

  it("builds mention ranges for batched outcome thread references", () => {
    const input = buildManagedThreadTurnStatusBatchInput({
      items: [
        {
          managedThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          turnStatus: "completed",
        },
        {
          managedThread: testThread({
            id: "thr_child_two",
            title: null,
          }),
          turnStatus: "failed",
        },
      ],
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }
    expect(textInput).toEqual({
      type: "text",
      text: expect.stringContaining("@thread:thr_child_one"),
      mentions: [
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: "thread",
            label: "Fix checkout flow",
            projectId: "proj_alpha",
            threadId: "thr_child_one",
            threadType: "standard",
          },
        },
        {
          start: expect.any(Number),
          end: expect.any(Number),
          resource: {
            kind: "thread",
            label: "thr_child_two",
            projectId: "proj_alpha",
            threadId: "thr_child_two",
            threadType: "standard",
          },
        },
      ],
    });
    expect(textInput.text).toContain("@thread:thr_child_two");
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", "@thread:thr_child_two"]);
  });

  it("does not match batched mention ranges inside earlier thread titles", () => {
    const nestedToken = "@thread:thr_child_two";
    const input = buildManagedThreadTurnStatusBatchInput({
      items: [
        {
          managedThread: testThread({
            id: "thr_child_one",
            title: `Title mentions ${nestedToken}`,
          }),
          turnStatus: "completed",
        },
        {
          managedThread: testThread({
            id: "thr_child_two",
            title: "Second thread",
          }),
          turnStatus: "failed",
        },
      ],
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }

    const titleTokenStart = textInput.text.indexOf(nestedToken);
    const secondLineTokenStart = textInput.text.lastIndexOf(nestedToken);
    expect(titleTokenStart).not.toBe(secondLineTokenStart);
    expect(textInput.mentions.map((mention) => mention.start)).toEqual([
      textInput.text.indexOf("@thread:thr_child_one"),
      secondLineTokenStart,
    ]);
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", nestedToken]);
  });
});
