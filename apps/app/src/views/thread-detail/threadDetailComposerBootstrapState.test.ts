import { describe, expect, it } from "vitest";
import { resolveThreadComposerBootstrapReady } from "./threadDetailComposerBootstrapState";

describe("resolveThreadComposerBootstrapReady", () => {
  it("uses cached bootstrap data while a background refetch is in flight", () => {
    expect(
      resolveThreadComposerBootstrapReady({
        hasData: true,
        isError: false,
        isFetching: true,
        isSuccess: true,
      }),
    ).toBe(true);
  });

  it("waits for an initial bootstrap fetch before enabling composer queries", () => {
    expect(
      resolveThreadComposerBootstrapReady({
        hasData: false,
        isError: false,
        isFetching: true,
        isSuccess: false,
      }),
    ).toBe(false);
  });

  it("allows fallback composer queries after an initial bootstrap error", () => {
    expect(
      resolveThreadComposerBootstrapReady({
        hasData: false,
        isError: true,
        isFetching: false,
        isSuccess: false,
      }),
    ).toBe(true);
  });
});
