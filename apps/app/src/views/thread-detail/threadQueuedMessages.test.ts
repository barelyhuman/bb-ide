import { describe, expect, it } from "vitest";
import type { PromptInput } from "@bb/domain";
import {
  formatQueuedMessagePreview,
  queuedInputToDraft,
} from "./threadQueuedMessages";

describe("threadQueuedMessages", () => {
  it("formats queued-message previews from text or attachment-only inputs", () => {
    const input: PromptInput[] = [
      { type: "text", text: "  First line  " },
      { type: "text", text: "Second line" },
    ];

    expect(formatQueuedMessagePreview(input)).toBe("First line\n\nSecond line");
    expect(
      formatQueuedMessagePreview([
        {
          type: "localFile",
          path: "/tmp/notes.md",
          name: "notes.md",
          sizeBytes: 10,
        },
      ]),
    ).toBe("Attachment only (notes.md)");
    expect(
      formatQueuedMessagePreview([
        {
          type: "localImage",
          path: "  ",
        },
      ]),
    ).toBe("Attachment only (Attachment)");
  });

  it("restores editable drafts from queued messages", () => {
    const draft = queuedInputToDraft([
      { type: "text", text: "Follow up" },
      {
        type: "localImage",
        path: "/tmp/image.png",
      },
    ]);
    const attachmentOnlyDraft = queuedInputToDraft([
      {
        type: "localImage",
        path: "  ",
      },
    ]);

    expect(draft).toEqual({
      text: "Follow up",
      attachments: [
        {
          type: "localImage",
          path: "/tmp/image.png",
          name: "image.png",
          sizeBytes: 0,
        },
      ],
    });
    expect(attachmentOnlyDraft.attachments[0]?.name).toBe("Attachment");
  });
});
