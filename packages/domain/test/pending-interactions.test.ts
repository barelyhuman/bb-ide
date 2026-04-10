import { describe, expect, it } from "vitest";
import {
  pendingInteractionMacOsPermissionsSchema,
  pendingInteractionCreateSchema,
  pendingInteractionResolutionSchema,
  pendingInteractionSchema,
} from "../src/index.js";

describe("pending interaction schemas", () => {
  it("parses command approval interactions", () => {
    expect(
      pendingInteractionCreateSchema.parse({
        threadId: "thr_123",
        turnId: "turn_123",
        providerId: "codex",
        providerThreadId: "provider-thread-123",
        providerRequestId: "request-123",
        payload: {
          kind: "command_approval",
          itemId: "item_123",
          reason: "Needs network access",
          command: "npm install",
          cwd: "/tmp/project",
          commandActions: [
            {
              type: "unknown",
              command: "npm install",
            },
          ],
          requestedPermissions: {
            network: {
              enabled: true,
            },
            fileSystem: null,
            macos: null,
          },
          availableDecisions: ["accept", "accept_for_session", "decline", "cancel"],
        },
      }),
    ).toMatchObject({
      providerId: "codex",
      payload: {
        kind: "command_approval",
        availableDecisions: ["accept", "accept_for_session", "decline", "cancel"],
      },
    });
  });

  it("parses command approvals with amendment decisions", () => {
    expect(
      pendingInteractionSchema.parse({
        id: "pi_124",
        threadId: "thr_124",
        turnId: "turn_124",
        providerId: "codex",
        providerThreadId: "provider-thread-124",
        providerRequestId: "request-126",
        status: "resolved",
        payload: {
          kind: "command_approval",
          itemId: "item_126",
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          requestedPermissions: null,
          availableDecisions: [
            {
              kind: "accept_with_exec_policy_amendment",
              execPolicyAmendment: ["allow", "git", "push"],
            },
            "decline",
            "cancel",
          ],
        },
        resolution: {
          kind: "command_approval",
          decision: {
            kind: "accept_with_exec_policy_amendment",
            execPolicyAmendment: ["allow", "git", "push"],
          },
        },
        statusReason: null,
        createdAt: 1,
        resolvedAt: 2,
      }),
    ).toMatchObject({
      resolution: {
        kind: "command_approval",
        decision: {
          kind: "accept_with_exec_policy_amendment",
        },
      },
    });
  });

  it("rejects mismatched payload and resolution kinds", () => {
    expect(() =>
      pendingInteractionSchema.parse({
        id: "pi_123",
        threadId: "thr_123",
        turnId: "turn_123",
        providerId: "codex",
        providerThreadId: "provider-thread-123",
        providerRequestId: "request-125",
        status: "resolved",
        payload: {
          kind: "command_approval",
          itemId: "item_125",
          reason: null,
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          requestedPermissions: null,
          availableDecisions: ["accept", "decline", "cancel"],
        },
        resolution: pendingInteractionResolutionSchema.parse({
          kind: "file_change_approval",
          decision: "accept",
        }),
        statusReason: null,
        createdAt: 1,
        resolvedAt: 2,
      }),
    ).toThrow();
  });

  it("rejects invalid macOS automation permission values", () => {
    expect(() =>
      pendingInteractionMacOsPermissionsSchema.parse({
        preferences: "none",
        automations: "invalid",
        launchServices: false,
        accessibility: false,
        calendar: false,
        reminders: false,
        contacts: "none",
      }),
    ).toThrow();
  });
});
