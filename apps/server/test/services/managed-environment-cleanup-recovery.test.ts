import { createEnvironment, getEnvironment } from "@bb/db";
import { recordEnvironmentCleanupRequest } from "@bb/db/internal-environment-lifecycle";
import { describe, expect, it } from "vitest";
import {
  MANAGED_ENVIRONMENT_ARCHIVE_CLEANUP_RECOVERY_INTERVAL_MS,
  runManagedEnvironmentArchiveCleanupRecoverySweep,
} from "../../src/services/system/periodic-sweeps.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const SWEEP_START_MS = 4_000_000_000_000;

describe("managed environment cleanup recovery sweep", () => {
  it("throttles recovery without arming the throttle on empty sweeps", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS,
      );

      const firstEnvironment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      recordEnvironmentCleanupRequest(
        harness.db,
        harness.hub,
        firstEnvironment.id,
        {
          requestedAt: SWEEP_START_MS,
        },
      );

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS + 1,
      );

      expect(
        getEnvironment(harness.db, firstEnvironment.id)?.status,
      ).toBe("destroyed");

      const throttledEnvironment = createEnvironment(harness.db, harness.hub, {
        hostId: host.id,
        managed: true,
        projectId: project.id,
        status: "ready",
        workspaceProvisionType: "managed-worktree",
      });
      recordEnvironmentCleanupRequest(
        harness.db,
        harness.hub,
        throttledEnvironment.id,
        {
          requestedAt: SWEEP_START_MS + 2,
        },
      );

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS + 10_000,
      );

      expect(
        getEnvironment(harness.db, throttledEnvironment.id)?.status,
      ).toBe("ready");

      await runManagedEnvironmentArchiveCleanupRecoverySweep(
        harness.deps,
        SWEEP_START_MS +
          1 +
          MANAGED_ENVIRONMENT_ARCHIVE_CLEANUP_RECOVERY_INTERVAL_MS,
      );

      expect(
        getEnvironment(harness.db, throttledEnvironment.id)?.status,
      ).toBe("destroyed");
    });
  });
});
