import { setTimeout as sleep } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

async function waitForPendingInteractionId(args: {
  harness: Awaited<ReturnType<typeof createTestAppHarness>>;
  threadId: string;
}): Promise<string> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const interactions = args.harness.deps.pendingInteractions.listThreadInteractions(
      args.threadId,
    );
    const pending = interactions.find((interaction) => interaction.status === "pending");
    if (pending) {
      return pending.id;
    }
    await sleep(10);
  }

  throw new Error("Timed out waiting for pending interaction");
}

describe("internal interactive request lifecycle", () => {
  it("persists an interactive request and waits for a later resolution", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-interaction-resolve",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const responsePromise = harness.app.request("/internal/session/interactive-request", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          interaction: {
            threadId: thread.id,
            turnId: "turn-1",
            providerId: "codex",
            providerThreadId: "provider-thread-1",
            providerRequestId: "request-1",
            providerRequestMethod: "item/commandExecution/requestApproval",
            payload: {
              kind: "command_approval",
              itemId: "item-1",
              approvalId: null,
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
              commandActions: [],
              requestedPermissions: null,
              availableDecisions: ["accept", "accept_for_session", "decline", "cancel"],
            },
          },
        }),
      });

      const interactionId = await waitForPendingInteractionId({
        harness,
        threadId: thread.id,
      });
      const resolved = harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId,
        resolution: {
          kind: "command_approval",
          decision: "accept_for_session",
        },
      });

      expect(resolved).toMatchObject({
        id: interactionId,
        status: "resolved",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "resolved",
        resolution: {
          kind: "command_approval",
          decision: "accept_for_session",
        },
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("interrupts pending interactive requests for provider exits", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-interaction-interrupt",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const responsePromise = harness.app.request("/internal/session/interactive-request", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          interaction: {
            threadId: thread.id,
            turnId: "turn-1",
            providerId: "codex",
            providerThreadId: "provider-thread-1",
            providerRequestId: "request-1",
            providerRequestMethod: "item/commandExecution/requestApproval",
            payload: {
              kind: "command_approval",
              itemId: "item-1",
              approvalId: null,
              reason: "Needs approval",
              command: "git push",
              cwd: "/tmp/project",
              commandActions: [],
              requestedPermissions: null,
              availableDecisions: ["accept", "accept_for_session", "decline", "cancel"],
            },
          },
        }),
      });

      await waitForPendingInteractionId({
        harness,
        threadId: thread.id,
      });

      const interruptResponse = await harness.app.request(
        "/internal/session/interactive-request/interrupt",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            providerId: "codex",
            threadIds: [thread.id],
            reason: "Provider exited",
          }),
        },
      );

      expect(interruptResponse.status).toBe(200);
      await expect(readJson(interruptResponse)).resolves.toEqual({
        ok: true,
        interactionIds: [expect.any(String)],
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "interrupted",
        reason: "Provider exited",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("persists Claude interactive requests and resolves them through the same lifecycle", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-claude-interaction-resolve",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "claude-code",
      });

      const responsePromise = harness.app.request("/internal/session/interactive-request", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          sessionId: session.id,
          interaction: {
            threadId: thread.id,
            turnId: "turn-claude-1",
            providerId: "claude-code",
            providerThreadId: "claude-thread-1",
            providerRequestId: "request-claude-1",
            providerRequestMethod: "item/permissions/requestApproval",
            payload: {
              kind: "permission_request",
              itemId: "item-claude-1",
              reason: "Need network access",
              toolName: "WebFetch",
              permissions: {
                network: { enabled: true },
                fileSystem: null,
              },
            },
          },
        }),
      });

      const interactionId = await waitForPendingInteractionId({
        harness,
        threadId: thread.id,
      });
      const resolved = harness.deps.pendingInteractions.resolvePendingInteraction({
        threadId: thread.id,
        interactionId,
        resolution: {
          kind: "permission_request",
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
          scope: "session",
        },
      });

      expect(resolved).toMatchObject({
        id: interactionId,
        status: "resolved",
      });

      const response = await responsePromise;
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        outcome: "resolved",
        resolution: {
          kind: "permission_request",
          permissions: {
            network: { enabled: true },
            fileSystem: null,
          },
          scope: "session",
        },
      });
    } finally {
      await harness.cleanup();
    }
  });
});
