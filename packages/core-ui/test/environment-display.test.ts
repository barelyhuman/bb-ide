import { describe, expect, it } from "vitest";
import type { Environment } from "@bb/domain";
import { formatEnvironmentDisplay } from "../src/environment-display.js";

function makeEnvironment(overrides?: Partial<Environment>): Environment {
  return {
    id: "env_test",
    projectId: "proj_test",
    hostId: "host_test",
    path: "/workspace",
    managed: false,
    isGitRepo: true,
    isWorktree: false,
    workspaceProvisionType: "unmanaged",
    baseBranch: null,
    branchName: null,
    defaultBranch: null,
    mergeBaseBranch: null,
    cleanupRequestedAt: null,
    cleanupMode: null,
    status: "ready",
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe("formatEnvironmentDisplay", () => {
  describe("local host", () => {
    it("returns 'Working locally' for unmanaged workspace", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment(),
        isLocalHost: true,
      });
      expect(result).toEqual({
        modeLabel: "Working locally",
        hostLabel: null,
        id: "env_test",
        location: "local",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });

    it("returns 'Worktree' for worktree workspace", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          isWorktree: true,
          workspaceProvisionType: "managed-worktree",
        }),
        isLocalHost: true,
      });
      expect(result).toEqual({
        modeLabel: "Worktree",
        hostLabel: null,
        id: "env_test",
        location: "local",
        mode: "worktree",
        workspaceDisplayKind: "managed-worktree",
      });
    });

    it("passes through host name when provided", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment(),
        isLocalHost: true,
        hostName: "My Machine",
      });
      expect(result.modeLabel).toBe("Working locally");
      expect(result.hostLabel).toBe("My Machine");
    });

    it("uses local direct-workspace display for personal environments", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          isGitRepo: false,
          workspaceProvisionType: "personal",
        }),
        isLocalHost: true,
      });
      expect(result).toMatchObject({
        modeLabel: "Working locally",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });
  });

  describe("provisioning", () => {
    it("reports 'Provisioning' for a worktree env before discovery populates isWorktree", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          status: "provisioning",
          workspaceProvisionType: "managed-worktree",
          isWorktree: false,
        }),
        isLocalHost: true,
      });
      expect(result.modeLabel).toBe("Provisioning");
      // Discovered structural properties are not yet known mid-provision.
      expect(result.mode).toBe("direct");
    });

    it("reports 'Provisioning' for a local unmanaged env", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({ status: "provisioning" }),
        isLocalHost: true,
      });
      expect(result.modeLabel).toBe("Provisioning");
    });

    it("reports 'Provisioning' for a remote env and keeps the host suffix", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({ status: "provisioning" }),
        isLocalHost: false,
        hostName: "Mac mini",
      });
      expect(result.modeLabel).toBe("Provisioning");
      expect(result.hostLabel).toBe("Mac mini");
      expect(result.location).toBe("remote");
    });
  });

  describe("remote host", () => {
    it("includes host name when provided", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment(),
        isLocalHost: false,
        hostName: "Remote Server",
      });
      expect(result).toEqual({
        modeLabel: "Working remotely",
        hostLabel: "Remote Server",
        id: "env_test",
        location: "remote",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });

    it("includes host name with worktree mode", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({ isWorktree: true }),
        isLocalHost: false,
        hostName: "Remote Server",
      });
      expect(result).toEqual({
        modeLabel: "Worktree",
        hostLabel: "Remote Server",
        id: "env_test",
        location: "remote",
        mode: "worktree",
        workspaceDisplayKind: "unmanaged-worktree",
      });
    });

    it("returns null hostLabel when host name is missing", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment(),
        isLocalHost: false,
      });
      expect(result.modeLabel).toBe("Working remotely");
      expect(result.hostLabel).toBeNull();
      expect(result.location).toBe("remote");
    });

    it("uses remote direct-workspace display for personal environments", () => {
      const result = formatEnvironmentDisplay({
        environment: makeEnvironment({
          isGitRepo: false,
          workspaceProvisionType: "personal",
        }),
        isLocalHost: false,
      });
      expect(result).toMatchObject({
        modeLabel: "Working remotely",
        mode: "direct",
        workspaceDisplayKind: "other",
      });
    });
  });
});
