import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  recoverManagedEnvironmentAgentSessionsOnBoot,
  scheduleManagedArtifactReconciliation,
} from "../startup-tasks.js";

afterEach(() => {
  vi.restoreAllMocks();
});

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

  it("pokes reachable env-agents and leaves unreachable sessions for heartbeat timeout handling", async () => {
    const beanbagRoot = mkdtempSync(join(tmpdir(), "bb-startup-tasks-"));
    const stateDir = join(beanbagRoot, "environment-agents", "proj-1");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "worktree-thread-1.json"), JSON.stringify({
      version: 1,
      baseUrl: "http://127.0.0.1:4310",
      authToken: "token-1",
      threadId: "thread-1",
      projectId: "proj-1",
      environmentId: "worktree",
    }));
    writeFileSync(join(stateDir, "worktree-thread-2.json"), JSON.stringify({
      version: 1,
      baseUrl: "http://127.0.0.1:4311",
      authToken: "token-2",
      threadId: "thread-2",
      projectId: "proj-1",
      environmentId: "worktree",
    }));

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.startsWith("http://127.0.0.1:4310/")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 202,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`offline: ${url}`);
    });

    const sessionRepo = {
      listActive: vi.fn().mockReturnValue([
        { id: "sess-1", threadId: "thread-1" },
        { id: "sess-2", threadId: "thread-2" },
      ]),
    };

    const result = await recoverManagedEnvironmentAgentSessionsOnBoot({
      runtimeEnv: { BEANBAG_ROOT: beanbagRoot } as NodeJS.ProcessEnv,
      sessionRepo,
      logger: {
        log: vi.fn(),
        warn: vi.fn(),
      },
    });

    expect(result).toEqual({
      activeSessionCount: 2,
      pokedCount: 1,
      unreachableCount: 1,
    });

    rmSync(beanbagRoot, { recursive: true, force: true });
  });
});
