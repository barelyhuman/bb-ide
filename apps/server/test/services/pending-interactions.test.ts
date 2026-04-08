import { describe, expect, it } from "vitest";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("pending interaction lifecycle", () => {
  it("interrupts waits that start with an already-aborted signal", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-pending-interaction-aborted-signal",
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

      const registered = harness.deps.pendingInteractions.registerPendingInteraction({
        threadId: thread.id,
        turnId: "turn-aborted-signal",
        providerId: "codex",
        providerThreadId: "provider-thread-aborted-signal",
        providerRequestId: "request-aborted-signal",
        providerRequestMethod: "item/commandExecution/requestApproval",
        payload: {
          kind: "command_approval",
          itemId: "item-aborted-signal",
          approvalId: null,
          reason: "Needs approval",
          command: "git push",
          cwd: "/tmp/project",
          commandActions: [],
          requestedPermissions: null,
          availableDecisions: ["accept", "accept_for_session", "decline", "cancel"],
        },
      });
      if (registered.outcome === "rejected") {
        throw new Error(`Expected interaction registration to succeed: ${registered.reason}`);
      }

      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.deps.pendingInteractions.waitForTerminalState({
          interactionId: registered.interaction.id,
          signal: controller.signal,
          abortReason: "Request aborted",
        }),
      ).resolves.toMatchObject({
        outcome: "interrupted",
        reason: "Request aborted",
        interaction: expect.objectContaining({
          id: registered.interaction.id,
          status: "interrupted",
          statusReason: "Request aborted",
        }),
      });
    } finally {
      await harness.cleanup();
    }
  });
});
