import { describe, expect, it } from "vitest";
import {
  appendVisibleTextBuffer,
  createVisibleTextBuffer,
  flushVisibleTextBuffer,
  getVisibleTextBufferFullLength,
  getVisibleTextBufferText,
} from "../src/visible-text-buffer.js";

describe("visible text buffer", () => {
  it("tracks visible text incrementally at newline boundaries", () => {
    const buffer = createVisibleTextBuffer();

    expect(appendVisibleTextBuffer(buffer, "hello")).toBe(true);
    expect(getVisibleTextBufferFullLength(buffer)).toBe(5);
    expect(getVisibleTextBufferText(buffer)).toBeUndefined();

    expect(appendVisibleTextBuffer(buffer, "\nworld")).toBe(true);
    expect(getVisibleTextBufferFullLength(buffer)).toBe(11);
    expect(getVisibleTextBufferText(buffer)).toBe("hello\n");
  });

  it("flushes trailing partial text without rescanning prior chunks", () => {
    const buffer = createVisibleTextBuffer();

    appendVisibleTextBuffer(buffer, "alpha");
    appendVisibleTextBuffer(buffer, "\nbeta");

    expect(flushVisibleTextBuffer(buffer)).toBe(true);
    expect(getVisibleTextBufferFullLength(buffer)).toBe(10);
    expect(getVisibleTextBufferText(buffer)).toBe("alpha\nbeta");
    expect(flushVisibleTextBuffer(buffer)).toBe(false);
  });
});
