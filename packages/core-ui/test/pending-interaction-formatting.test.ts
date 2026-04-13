import { describe, expect, it } from "vitest";
import {
  formatPendingInteractionCommandApprovalResolutionMessage,
  formatPendingInteractionCommandApprovalResolutionOutcome,
  formatPendingInteractionFileChangeApprovalResolutionMessage,
  formatPendingInteractionFileChangeApprovalResolutionOutcome,
  formatPendingInteractionPermissionResolutionMessage,
  formatPendingInteractionPermissionResolutionOutcome,
  summarizePendingInteractionRequestedPermissions,
} from "../src/index.js";

describe("pending interaction formatting", () => {
  it("summarizes requested permissions consistently", () => {
    expect(
      summarizePendingInteractionRequestedPermissions({
        network: { enabled: true },
        fileSystem: {
          read: ["/tmp/read-a", "/tmp/read-b"],
          write: ["/tmp/write-a"],
        },
        macos: {
          preferences: "read_only",
          automations: "all",
          launchServices: true,
          accessibility: false,
          calendar: false,
          reminders: true,
          contacts: "none",
        },
      }),
    ).toEqual([
      "Network access",
      "Read 2 paths",
      "Write 1 path",
      "macOS launch services",
      "macOS reminders",
      "macOS preferences (read only)",
      "macOS automation (all apps)",
    ]);
  });

  it("formats approval outcomes and timeline messages consistently", () => {
    expect(formatPendingInteractionCommandApprovalResolutionOutcome("allow_for_session")).toBe(
      "approved for this session",
    );
    expect(formatPendingInteractionCommandApprovalResolutionMessage("deny")).toBe(
      "Command denied",
    );
    expect(formatPendingInteractionFileChangeApprovalResolutionOutcome("deny")).toBe(
      "denied",
    );
    expect(formatPendingInteractionFileChangeApprovalResolutionMessage("allow_once")).toBe(
      "File changes approved",
    );
    expect(
      formatPendingInteractionPermissionResolutionOutcome({
        kind: "approval",
        decision: "deny",
      }),
    ).toBe("denied");
    expect(
      formatPendingInteractionPermissionResolutionMessage({
        kind: "approval",
        decision: "allow_for_session",
        grantedPermissions: {
          network: { enabled: true },
          fileSystem: null,
        },
      }),
    ).toBe("Permissions granted for this session");
  });
});
