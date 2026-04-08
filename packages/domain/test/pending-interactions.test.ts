import { describe, expect, it } from "vitest";
import {
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
              options: [
                {
                  label: "prod",
                  description: "Use production",
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
});
