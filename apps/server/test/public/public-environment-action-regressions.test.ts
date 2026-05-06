import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("public environment action regressions", () => {
  it("rejects malformed squash-merge payload with a 400", async () => {
    const harness = await createTestAppHarness();
    try {
      const squashMergeResponse = await harness.app.request(
        "/api/v1/environments/env_missing/actions",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "squash_merge",
          }),
        },
      );
      expect(squashMergeResponse.status).toBe(400);
      await expect(readJson(squashMergeResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects legacy environment action payloads that still send threadId", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-target",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/thread-target",
      });

      const mismatchedResponse = await harness.app.request(
        `/api/v1/environments/${environment.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action: "commit",
            threadId: "thread-legacy",
          }),
        },
      );
      expect(mismatchedResponse.status).toBe(400);
      await expect(readJson(mismatchedResponse)).resolves.toMatchObject({
        code: "invalid_request",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects demote when the environment branch or merge base branch is missing", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-demote-guard",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/demote-guard-project",
      });
      const missingEnvBranch = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/demote-guard-project/.bb-worktrees/missing-env-branch",
        branchName: null,
        mergeBaseBranch: "main",
      });

      const missingEnvBranchResponse = await harness.app.request(
        `/api/v1/environments/${missingEnvBranch.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "demote" }),
        },
      );
      expect(missingEnvBranchResponse.status).toBe(409);
      await expect(readJson(missingEnvBranchResponse)).resolves.toMatchObject({
        code: "invalid_request",
        message: "Environment cannot be demoted",
      });

      const missingDefaultBranch = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        managed: true,
        workspaceProvisionType: "managed-worktree",
        path: "/tmp/demote-guard-project/.bb-worktrees/missing-default-branch",
        branchName: "bb/demote-guard",
        defaultBranch: null,
        mergeBaseBranch: "main",
      });

      const missingDefaultBranchResponse = await harness.app.request(
        `/api/v1/environments/${missingDefaultBranch.id}/actions`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "demote" }),
        },
      );
      expect(missingDefaultBranchResponse.status).toBe(409);
      await expect(
        readJson(missingDefaultBranchResponse),
      ).resolves.toMatchObject({
        code: "invalid_request",
        message: "Environment cannot be demoted",
      });
    } finally {
      await harness.cleanup();
    }
  });
});
