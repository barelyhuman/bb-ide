import { describe, expect, it, vi } from "vitest";
import { scheduleManagedArtifactReconciliation } from "../startup-tasks.js";

describe("startup tasks", () => {
  it("defers managed artifact reconciliation until after startup returns", async () => {
    const threadManager = {
      reconcileManagedArtifacts: vi.fn().mockResolvedValue(undefined),
    };
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    scheduleManagedArtifactReconciliation(threadManager, logger);

    expect(threadManager.reconcileManagedArtifacts).not.toHaveBeenCalled();

    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.resolve();

    expect(logger.log).toHaveBeenCalledWith(
      "Reconciling managed storage artifacts in background...",
    );
    expect(threadManager.reconcileManagedArtifacts).toHaveBeenCalledTimes(1);
    expect(logger.log).toHaveBeenCalledWith(
      "Managed artifact reconciliation complete.",
    );
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs cleanup warnings without throwing when background reconciliation fails", async () => {
    const threadManager = {
      reconcileManagedArtifacts: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const logger = {
      log: vi.fn(),
      warn: vi.fn(),
    };

    scheduleManagedArtifactReconciliation(threadManager, logger);

    await new Promise<void>((resolve) => setImmediate(resolve));
    await Promise.resolve();

    expect(threadManager.reconcileManagedArtifacts).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "Managed artifact cleanup skipped: boom",
    );
  });
});
