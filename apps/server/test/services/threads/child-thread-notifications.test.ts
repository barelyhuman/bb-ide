import { describe, expect, it } from "vitest";
import {
  buildChildThreadNeedsAttentionInput,
  buildChildThreadTurnStatusBatchInput,
  renderChildThreadTurnStatusBatchMessage,
  type ChildThreadNotificationSource,
} from "../../../src/services/threads/child-thread-notifications.js";

interface TestThreadArgs {
  id: string;
  title: string | null;
}

function testThread(args: TestThreadArgs): ChildThreadNotificationSource {
  return {
    id: args.id,
    projectId: "proj_alpha",
    title: args.title,
  };
}

describe("child thread notifications", () => {
  it("preserves manual-stop safety guidance for interrupted batched outcomes", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child",
            title: "Fix checkout flow",
          }),
          turnStatus: "interrupted",
        },
      ],
    });

    expect(message).toContain("@thread:thr_child was interrupted.");
    expect(message).not.toContain("Multiple child threads updated:");
    expect(message).toContain(
      "If it was stopped manually by the user, treat that as intentional; do not resume, restart, retry, replace, or continue the work unless the user explicitly asks.",
    );
  });

  it("renders multiple child outcomes with a plural first line", () => {
    const message = renderChildThreadTurnStatusBatchMessage({
      items: [
        {
          childThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          turnStatus: "completed",
        },
        {
          childThread: testThread({
            id: "thr_child_two",
            title: "Patch deploy script",
          }),
          turnStatus: "failed",
        },
      ],
    });

    expect(message).toContain(
      [
        "[bb system]",
        "",
        "Multiple child threads updated:",
        "- @thread:thr_child_one completed.",
        "- @thread:thr_child_two failed.",
      ].join("\n"),
    );
  });

  it("builds mention ranges for batched outcome thread references", () => {
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          childThread: testThread({
            id: "thr_child_one",
            title: "Fix checkout flow",
          }),
          turnStatus: "completed",
        },
        {
          childThread: testThread({
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
          },
        },
      ],
    });
    expect(textInput.text).toContain("@thread:thr_child_two");
    expect(textInput.text).toContain("Multiple child threads updated:");
    expect(
      textInput.mentions.map((mention) =>
        textInput.text.slice(mention.start, mention.end),
      ),
    ).toEqual(["@thread:thr_child_one", "@thread:thr_child_two"]);
  });

  it("does not render raw title suffixes next to rich thread mentions", () => {
    const nestedToken = "@thread:thr_child_two";
    const input = buildChildThreadTurnStatusBatchInput({
      items: [
        {
          childThread: testThread({
            id: "thr_child_one",
            title: `Title mentions ${nestedToken}`,
          }),
          turnStatus: "completed",
        },
        {
          childThread: testThread({
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

    const secondLineTokenStart = textInput.text.lastIndexOf(nestedToken);
    expect(textInput.text).not.toContain("Title mentions");
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

  it("builds mention ranges for needs-attention thread references", () => {
    const input = buildChildThreadNeedsAttentionInput({
      childThread: testThread({
        id: "thr_child",
        title: "Backend cleanup",
      }),
    });

    expect(input).toHaveLength(1);
    const [textInput] = input;
    if (!textInput || textInput.type !== "text") {
      throw new Error("Expected one text input");
    }
    const threadMention = "@thread:thr_child";
    const mentionStart = textInput.text.indexOf(threadMention);
    expect(textInput.mentions).toEqual([
      {
        start: mentionStart,
        end: mentionStart + threadMention.length,
        resource: {
          kind: "thread",
          label: "Backend cleanup",
          projectId: "proj_alpha",
          threadId: "thr_child",
        },
      },
    ]);
  });
});
