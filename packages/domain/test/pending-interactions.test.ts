import { describe, expect, it } from "vitest";
import {
  formatPendingInteractionCommandApprovalResolutionMessage,
  formatPendingInteractionCommandApprovalResolutionOutcome,
  formatPendingInteractionFileChangeApprovalResolutionMessage,
  formatPendingInteractionFileChangeApprovalResolutionOutcome,
  formatPendingInteractionPermissionResolutionMessage,
  formatPendingInteractionPermissionResolutionOutcome,
  hasPendingInteractionGrantedPermissions,
  normalizePendingInteractionQuestionOption,
  normalizePendingInteractionRequestedPermissionProfile,
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
        providerRequestMethod: "item/commandExecution/requestApproval",
        payload: {
          kind: "command_approval",
          itemId: "item_123",
          approvalId: null,
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
        providerRequestMethod: "item/commandExecution/requestApproval",
        status: "resolved",
        payload: {
          kind: "command_approval",
          itemId: "item_126",
          approvalId: null,
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

  it("parses resolved user input interactions", () => {
    expect(
      pendingInteractionSchema.parse({
        id: "pi_123",
        threadId: "thr_123",
        turnId: "turn_123",
        providerId: "codex",
        providerThreadId: "provider-thread-123",
        providerRequestId: "request-124",
        providerRequestMethod: "item/tool/requestUserInput",
        status: "resolved",
        payload: {
          kind: "user_input_request",
          itemId: "item_124",
          questions: [
            {
              id: "environment",
              header: "Target",
              question: "Which environment should I use?",
              allowsOther: true,
              isSecret: false,
              multiSelect: false,
              options: [
                {
                  label: "prod",
                  description: "Use production",
                  preview: null,
                },
              ],
            },
          ],
        },
        resolution: {
          kind: "user_input_request",
          answers: {
            environment: ["prod"],
          },
        },
        statusReason: null,
        createdAt: 1,
        resolvedAt: 2,
      }),
    ).toMatchObject({
      status: "resolved",
      resolution: {
        kind: "user_input_request",
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
        providerRequestMethod: "item/tool/requestUserInput",
        status: "resolved",
        payload: {
          kind: "user_input_request",
          itemId: "item_125",
          questions: [],
        },
        resolution: pendingInteractionResolutionSchema.parse({
          kind: "command_approval",
          decision: "accept",
        }),
        statusReason: null,
        createdAt: 1,
        resolvedAt: 2,
      }),
    ).toThrow();
  });

  it("normalizes question options to an explicit null preview", () => {
    expect(
      normalizePendingInteractionQuestionOption({
        label: "prod",
        description: "Use production",
        preview: undefined,
      }),
    ).toEqual({
      label: "prod",
      description: "Use production",
      preview: null,
    });
  });

  it("normalizes requested permission profiles to explicit nulls and arrays", () => {
    expect(
      normalizePendingInteractionRequestedPermissionProfile({
        network: {
          enabled: undefined,
        },
        fileSystem: {
          read: null,
          write: undefined,
        },
      }),
    ).toEqual({
      network: {
        enabled: null,
      },
      fileSystem: {
        read: [],
        write: [],
      },
    });
  });

  it("formats approval outcomes and timeline messages consistently", () => {
    expect(formatPendingInteractionCommandApprovalResolutionOutcome("accept_for_session")).toBe(
      "approved for this session",
    );
    expect(
      formatPendingInteractionCommandApprovalResolutionOutcome({
        kind: "accept_with_exec_policy_amendment",
        execPolicyAmendment: ["allow", "git", "push"],
      }),
    ).toBe("approved with exec policy amendment");
    expect(formatPendingInteractionCommandApprovalResolutionMessage("cancel")).toBe(
      "Command request cancelled",
    );
    expect(formatPendingInteractionFileChangeApprovalResolutionOutcome("decline")).toBe(
      "denied",
    );
    expect(formatPendingInteractionFileChangeApprovalResolutionMessage("accept")).toBe(
      "File changes approved",
    );
    expect(
      hasPendingInteractionGrantedPermissions({
        network: { enabled: true },
        fileSystem: null,
      }),
    ).toBe(true);
    expect(
      formatPendingInteractionPermissionResolutionOutcome({
        permissions: {
          network: null,
          fileSystem: null,
        },
        scope: "turn",
      }),
    ).toBe("denied");
    expect(
      formatPendingInteractionPermissionResolutionMessage({
        permissions: {
          network: { enabled: true },
          fileSystem: null,
        },
        scope: "session",
      }),
    ).toBe("Permissions granted for this session");
  });
});
