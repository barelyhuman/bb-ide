import { createProjectSource } from "@bb/db";
import { describe, expect, it } from "vitest";
import { resolveThreadRuntimeCommandConfig } from "../src/services/thread-runtime-config.js";
import {
  seedEnvironment,
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "./helpers/seed.js";
import { createTestAppHarness } from "./helpers/test-app.js";

describe("thread runtime config", () => {
  it("uses the environment host's source path for manager project root instructions", async () => {
    const harness = await createTestAppHarness();
    try {
      const defaultHost = seedHost(harness.deps, { id: "host-runtime-default" });
      const secondaryHost = seedHost(harness.deps, { id: "host-runtime-secondary" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: defaultHost.id,
        path: "/tmp/runtime-default-root",
      });
      createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        type: "local_path",
        hostId: secondaryHost.id,
        path: "/tmp/runtime-secondary-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: secondaryHost.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/runtime-secondary-root/.bb-worktrees/manager",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(harness.deps, {
        thread: managerThread,
        environment: {
          hostId: environment.hostId,
          id: environment.id,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        isThreadCreation: true,
      });

      expect(runtimeConfig.instructions).toContain(
        "Project root: `/tmp/runtime-secondary-root`",
      );
      expect(runtimeConfig.instructions).not.toContain(
        "Project root: `/tmp/runtime-default-root`",
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects manager runtime config when the environment host has no project source", async () => {
    const harness = await createTestAppHarness();
    try {
      const defaultHost = seedHost(harness.deps, { id: "host-runtime-missing-default" });
      const missingSourceHost = seedHost(harness.deps, { id: "host-runtime-missing-secondary" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: defaultHost.id,
        path: "/tmp/runtime-missing-default-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: missingSourceHost.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/runtime-missing-default-root/.bb-worktrees/manager",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      await expect(
        resolveThreadRuntimeCommandConfig(harness.deps, {
          thread: managerThread,
          environment: {
            hostId: environment.hostId,
            id: environment.id,
            path: environment.path,
            workspaceProvisionType: environment.workspaceProvisionType,
          },
          isThreadCreation: true,
        }),
      ).rejects.toThrow("No project source configured for this host");
    } finally {
      await harness.cleanup();
    }
  });
});
