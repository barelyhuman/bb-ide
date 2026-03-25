import { describe, it, expect } from "vitest";
import type { ThreadStatus } from "@bb/domain";
import { statusText as threadStatusText } from "../commands/thread/index.js";

describe("thread statusText()", () => {
  const cases: Array<{ status: ThreadStatus; text: string }> = [
    { status: "created", text: "created" },
    { status: "provisioning", text: "provisioning" },
    { status: "error", text: "error" },
    { status: "idle", text: "idle" },
    { status: "active", text: "active" },
  ];

  for (const { status, text } of cases) {
    it(`returns ${text} for ${status}`, () => {
      expect(threadStatusText(status)).toBe(text);
    });
  }
});
