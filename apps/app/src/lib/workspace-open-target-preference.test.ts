import type { WorkspaceOpenTarget } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { resolvePreferredWorkspaceOpenTarget } from "./workspace-open-target-preference";

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  label: "Finder",
};

const terminalTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "terminal",
  label: "Terminal",
};

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  label: "VS Code",
};

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  label: "Default App",
};

describe("resolvePreferredWorkspaceOpenTarget", () => {
  it("chooses the stored target when it supports the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openDirectory",
        preferredTargetId: "finder",
        targets: [vscodeTarget, finderTarget],
      }),
    ).toBe(finderTarget);
  });

  it("falls back to the first target with the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        preferredTargetId: null,
        targets: [finderTarget, defaultAppTarget, vscodeTarget],
      }),
    ).toBe(defaultAppTarget);
  });

  it("ignores stored targets that do not support the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        preferredTargetId: "finder",
        targets: [finderTarget, vscodeTarget],
      }),
    ).toBe(vscodeTarget);
  });

  it("returns null when no available target supports the requested capability", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openFile",
        preferredTargetId: null,
        targets: [finderTarget, terminalTarget],
      }),
    ).toBeNull();
  });

  it("preserves stale stored preferences by falling back at runtime", () => {
    expect(
      resolvePreferredWorkspaceOpenTarget({
        capability: "openDirectory",
        preferredTargetId: "cursor",
        targets: [finderTarget],
      }),
    ).toBe(finderTarget);
  });
});
