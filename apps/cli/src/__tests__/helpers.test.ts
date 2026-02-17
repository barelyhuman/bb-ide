import { describe, it, expect } from "vitest";
import type { TaskStatus, ThreadStatus } from "@beanbag/core";
import { formatUptime } from "../commands/daemon.js";
import { statusIcon as threadStatusIcon } from "../commands/thread.js";
import { statusIcon as taskStatusIcon } from "../commands/task.js";

describe("formatUptime()", () => {
  it("formats seconds only", () => {
    expect(formatUptime(0)).toBe("0s");
    expect(formatUptime(1)).toBe("1s");
    expect(formatUptime(30)).toBe("30s");
    expect(formatUptime(59)).toBe("59s");
    expect(formatUptime(59.9)).toBe("59s"); // floors, doesn't round
  });

  it("formats minutes and seconds", () => {
    expect(formatUptime(60)).toBe("1m 0s");
    expect(formatUptime(61)).toBe("1m 1s");
    expect(formatUptime(90)).toBe("1m 30s");
    expect(formatUptime(125)).toBe("2m 5s");
    expect(formatUptime(3599)).toBe("59m 59s");
  });

  it("formats hours and minutes", () => {
    expect(formatUptime(3600)).toBe("1h 0m");
    expect(formatUptime(3661)).toBe("1h 1m");
    expect(formatUptime(7200)).toBe("2h 0m");
    expect(formatUptime(7320)).toBe("2h 2m");
    expect(formatUptime(86400)).toBe("24h 0m");
  });

  it("drops seconds from hours display", () => {
    // 1h 1m 30s should display as 1h 1m (no seconds)
    expect(formatUptime(3690)).toBe("1h 1m");
  });
});

describe("statusIcon()", () => {
  const threadStatusCases: Array<{ status: ThreadStatus; icon: string }> = [
    { status: "created", icon: "\u25CC" },
    { status: "provisioning", icon: "\u25D1" },
    { status: "provisioning_failed", icon: "\u25C9" },
    { status: "idle", icon: "\u25CB" },
    { status: "active", icon: "\u25D4" },
  ];

  for (const { status, icon } of threadStatusCases) {
    it(`returns ${icon} for thread status ${status}`, () => {
      expect(threadStatusIcon(status)).toBe(icon);
    });
  }
});

describe("task statusIcon()", () => {
  const taskStatusCases: Array<{ status: TaskStatus; icon: string }> = [
    { status: "open", icon: "\u25CB" },
    { status: "in_progress", icon: "\u25D4" },
    { status: "blocked", icon: "\u25D1" },
    { status: "closed", icon: "\u25CF" },
  ];

  for (const { status, icon } of taskStatusCases) {
    it(`returns ${icon} for task status ${status}`, () => {
      expect(taskStatusIcon(status)).toBe(icon);
    });
  }
});
