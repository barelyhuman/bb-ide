import { describe, expect, it } from "vitest";
import { shouldLoadNestedRows } from "./turnSummaryRowLoaderHelpers";

describe("turnSummaryRowLoaderHelpers", () => {
  it("computes nested row loading eligibility", () => {
    expect(
      shouldLoadNestedRows({
        cachedRowCount: 0,
        inlineRowCount: 0,
        isLoading: false,
        threadId: "thread-1",
      }),
    ).toBe(true);
    expect(
      shouldLoadNestedRows({
        cachedRowCount: 1,
        inlineRowCount: 0,
        isLoading: false,
        threadId: "thread-1",
      }),
    ).toBe(false);
    expect(
      shouldLoadNestedRows({
        cachedRowCount: 0,
        inlineRowCount: 0,
        isLoading: true,
        threadId: "thread-1",
      }),
    ).toBe(false);
    expect(
      shouldLoadNestedRows({
        cachedRowCount: 0,
        inlineRowCount: 2,
        isLoading: false,
        threadId: "thread-1",
      }),
    ).toBe(false);
    expect(
      shouldLoadNestedRows({
        cachedRowCount: 0,
        inlineRowCount: 0,
        isLoading: false,
        threadId: undefined,
      }),
    ).toBe(false);
  });
});
