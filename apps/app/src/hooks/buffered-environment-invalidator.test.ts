import { afterEach, describe, expect, it, vi } from "vitest";
import { createBufferedEnvironmentInvalidator } from "./buffered-environment-invalidator";

describe("createBufferedEnvironmentInvalidator", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("deduplicates repeated environment changes within the debounce window", () => {
    vi.useFakeTimers();
    const flushChangedEnvironmentIds = vi.fn();
    const invalidator = createBufferedEnvironmentInvalidator({
      debounceMs: 100,
      flushChangedEnvironmentIds,
      maxWaitMs: 300,
    });

    invalidator.markChanged("env-1");
    vi.advanceTimersByTime(50);
    invalidator.markChanged("env-1");
    vi.advanceTimersByTime(99);

    expect(flushChangedEnvironmentIds).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(flushChangedEnvironmentIds).toHaveBeenCalledTimes(1);
    expect(flushChangedEnvironmentIds).toHaveBeenCalledWith(["env-1"]);
  });

  it("flushes multiple changed environments together at max wait", () => {
    vi.useFakeTimers();
    const flushChangedEnvironmentIds = vi.fn();
    const invalidator = createBufferedEnvironmentInvalidator({
      debounceMs: 100,
      flushChangedEnvironmentIds,
      maxWaitMs: 250,
    });

    invalidator.markChanged("env-1");
    vi.advanceTimersByTime(90);
    invalidator.markChanged("env-2");
    vi.advanceTimersByTime(90);
    invalidator.markChanged("env-1");
    vi.advanceTimersByTime(69);

    expect(flushChangedEnvironmentIds).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);

    expect(flushChangedEnvironmentIds).toHaveBeenCalledTimes(1);
    expect(flushChangedEnvironmentIds).toHaveBeenCalledWith(["env-1", "env-2"]);
  });

  it("cancels pending flushes during dispose", () => {
    vi.useFakeTimers();
    const flushChangedEnvironmentIds = vi.fn();
    const invalidator = createBufferedEnvironmentInvalidator({
      debounceMs: 100,
      flushChangedEnvironmentIds,
      maxWaitMs: 250,
    });

    invalidator.markChanged("env-1");
    invalidator.dispose();
    vi.runAllTimers();

    expect(flushChangedEnvironmentIds).not.toHaveBeenCalled();
  });
});
