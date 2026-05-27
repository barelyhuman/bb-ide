import { describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import {
  resolveProjectMainThreadEnvironment,
  type ProjectMainSelectedBranch,
} from "./project-main-thread-environment";

const projectId = "proj_123";
const hostWorktreeEnvironmentValue = "host:host_123:worktree";
const hostLocalEnvironmentValue = "host:host_123:local";

function selectedBranch(name: string): ProjectMainSelectedBranch {
  return { name, isNew: false };
}

describe("resolveProjectMainThreadEnvironment", () => {
  it("omits unmanaged branch checkout when no branch is selected", () => {
    expect(
      resolveProjectMainThreadEnvironment({
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: {
        type: "unmanaged",
        path: null,
      },
    });
  });

  it("sends explicit existing branch checkout for host local", () => {
    expect(
      resolveProjectMainThreadEnvironment({
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: { kind: "existing", name: "develop" },
      },
    });
  });

  it("sends explicit new branch checkout for host local", () => {
    expect(
      resolveProjectMainThreadEnvironment({
        environmentValue: hostLocalEnvironmentValue,
        projectId,
        selectedBranch: { name: "develop", isNew: true },
      }),
    ).toMatchObject({
      workspace: {
        type: "unmanaged",
        branch: { kind: "new" },
      },
    });
  });

  it("sends default base branch for managed worktrees without an explicit pick", () => {
    expect(
      resolveProjectMainThreadEnvironment({
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: null,
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "default" },
      },
    });
  });

  it("sends a named base branch when the selected branch matches the env's current", () => {
    expect(
      resolveProjectMainThreadEnvironment({
        environmentValue: hostWorktreeEnvironmentValue,
        projectId,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toMatchObject({
      workspace: {
        type: "managed-worktree",
        baseBranch: { kind: "named", name: "develop" },
      },
    });
  });

  it("uses personal workspaces for the personal project", () => {
    expect(
      resolveProjectMainThreadEnvironment({
        environmentValue: hostLocalEnvironmentValue,
        projectId: PERSONAL_PROJECT_ID,
        selectedBranch: selectedBranch("develop"),
      }),
    ).toEqual({
      type: "host",
      hostId: "host_123",
      workspace: { type: "personal" },
    });
  });
});
