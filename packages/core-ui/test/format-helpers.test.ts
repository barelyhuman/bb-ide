import { describe, expect, it } from "vitest";
import { capitalize, durationToString, messageId } from "../src/format-helpers.js";

describe("durationToString", () => {
  it("returns undefined for undefined input", () => {
    expect(durationToString(undefined)).toBeUndefined();
  });

  it("formats sub-second durations as milliseconds", () => {
    expect(durationToString(0)).toBe("0ms");
    expect(durationToString(50)).toBe("50ms");
    expect(durationToString(999)).toBe("999ms");
  });

  it("formats exact seconds without decimals", () => {
    expect(durationToString(1000)).toBe("1s");
    expect(durationToString(5000)).toBe("5s");
  });

  it("formats fractional seconds with one decimal", () => {
    expect(durationToString(1500)).toBe("1.5s");
    expect(durationToString(2300)).toBe("2.3s");
  });

  it("formats durations over 60 seconds as minutes + seconds", () => {
    expect(durationToString(60_000)).toBe("1m 0s");
    expect(durationToString(90_000)).toBe("1m 30s");
    expect(durationToString(125_000)).toBe("2m 5s");
  });
});

describe("capitalize", () => {
  it("capitalizes the first character", () => {
    expect(capitalize("hello")).toBe("Hello");
    expect(capitalize("a")).toBe("A");
  });

  it("handles empty string", () => {
    expect(capitalize("")).toBe("");
  });

  it("leaves already capitalized strings unchanged", () => {
    expect(capitalize("Hello")).toBe("Hello");
  });
});

describe("messageId", () => {
  it("joins parts with colons", () => {
    expect(messageId("thread-1", "user", "key-1")).toBe("thread-1:user:key-1");
  });
});
