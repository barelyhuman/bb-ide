import { describe, expect, it } from "vitest";
import { resolveStoredStandardManagerTimelinePreference } from "./manager-timeline-view-preference";

describe("resolveStoredStandardManagerTimelinePreference", () => {
  it("prefers the current key, migrates the legacy key, and falls back for invalid values", () => {
    expect(
      resolveStoredStandardManagerTimelinePreference({
        currentValue: "false",
        legacyValue: "true",
        initialValue: true,
      }),
    ).toBe(false);
    expect(
      resolveStoredStandardManagerTimelinePreference({
        currentValue: "invalid",
        legacyValue: "true",
        initialValue: false,
      }),
    ).toBe(false);
    expect(
      resolveStoredStandardManagerTimelinePreference({
        currentValue: null,
        legacyValue: "true",
        initialValue: false,
      }),
    ).toBe(true);
    expect(
      resolveStoredStandardManagerTimelinePreference({
        currentValue: null,
        legacyValue: "show-all",
        initialValue: false,
      }),
    ).toBe(false);
  });
});
