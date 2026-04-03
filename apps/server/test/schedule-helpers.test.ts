import { describe, expect, it } from "vitest";
import { computeNextScheduledTime } from "../src/services/schedule-helpers.js";

describe("schedule helpers", () => {
  it("moves spring-forward schedules to the next valid local time", () => {
    const nextRunAt = computeNextScheduledTime({
      cron: "0 2 * * *",
      timezone: "America/Los_Angeles",
      now: Date.parse("2026-03-08T09:55:00.000Z"),
    });

    expect(nextRunAt).toBe(Date.parse("2026-03-08T10:00:00.000Z"));
  });

  it("picks the first repeated local time during fall-back", () => {
    const nextRunAt = computeNextScheduledTime({
      cron: "30 1 * * *",
      timezone: "America/Los_Angeles",
      now: Date.parse("2026-11-01T08:10:00.000Z"),
    });

    expect(nextRunAt).toBe(Date.parse("2026-11-01T08:30:00.000Z"));
  });

  it("moves to the next day after the repeated fall-back hour has already passed", () => {
    const nextRunAt = computeNextScheduledTime({
      cron: "30 1 * * *",
      timezone: "America/Los_Angeles",
      now: Date.parse("2026-11-01T09:40:00.000Z"),
    });

    expect(nextRunAt).toBe(Date.parse("2026-11-02T09:30:00.000Z"));
  });
});
