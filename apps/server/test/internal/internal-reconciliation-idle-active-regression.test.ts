import { eq } from "drizzle-orm";
import {
  clientTurnRequests,
  getThread,
  getThreadOperation,
  markThreadStopRequested,
} from "@bb/db";
import { upsertThreadOperationRecord } from "@bb/db/internal-lifecycle";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import { internalAuthHeaders, waitForQueuedCommand } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("internal reconciliation idle-active regression", () => {
  it("promotes idle threads to active when the daemon reports them as active", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-idle-active-reconcile",
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
        status: "idle",
      });

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-idle-active-reconcile",
          hostName: "Idle Active Host",
          hostType: "persistent",
          dataDir: "/tmp/idle-active-reconcile-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [
            {
              threadId: thread.id,
            },
          ],
        }),
      });

      expect(response.status).toBe(201);
      expect(getThread(harness.db, thread.id)?.status).toBe("active");
    });
  });

  it("settles pending turn requests when a daemon restart loses an active thread", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-restart-request-reconcile",
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
        status: "active",
      });
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-thread-restart-request-reconcile",
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-restart-request-reconcile",
        providerThreadId: "provider-thread-restart-request-reconcile",
      });

      await sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input: [{ type: "text", text: "lost during daemon restart" }],
          mode: "auto",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });
      const queued = await waitForQueuedCommand(
        harness,
        ({ command, row }) =>
          row.state === "pending" &&
          command.type === "turn.submit" &&
          command.threadId === thread.id,
      );
      expect(
        harness.db
          .select()
          .from(clientTurnRequests)
          .where(eq(clientTurnRequests.commandId, queued.row.id))
          .get(),
      ).toMatchObject({
        status: "pending",
        threadId: thread.id,
      });

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-after-restart-request-reconcile",
          hostName: "Restart Request Reconcile Host",
          hostType: "persistent",
          dataDir: "/tmp/restart-request-reconcile-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });

      expect(response.status).toBe(201);
      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(
        harness.db
          .select()
          .from(clientTurnRequests)
          .where(eq(clientTurnRequests.commandId, queued.row.id))
          .get(),
      ).toMatchObject({
        commandCompletedAt: null,
        message: "Host daemon restarted before provider accepted the request",
        reasonCode: "provider_restarted",
        settledAt: expect.any(Number),
        status: "canceled",
        threadId: thread.id,
      });
    });
  });

  it("does not finalize a stop when thread lifecycle rejects finalization", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-starting-stop-reconcile",
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
        status: "active",
      });
      markThreadStopRequested(harness.db, harness.hub, {
        threadId: thread.id,
      });
      upsertThreadOperationRecord(harness.db, {
        threadId: thread.id,
        kind: "start",
        payload: JSON.stringify({
          type: "thread.start",
          environmentId: environment.id,
          threadId: thread.id,
        }),
      });

      const response = await harness.app.request("/internal/session/open", {
        method: "POST",
        headers: internalAuthHeaders(harness),
        body: JSON.stringify({
          hostId: host.id,
          instanceId: "instance-starting-stop-reconcile",
          hostName: "Starting Stop Host",
          hostType: "persistent",
          dataDir: "/tmp/starting-stop-reconcile-data",
          protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
          activeThreads: [],
        }),
      });

      expect(response.status).toBe(201);
      expect(getThread(harness.db, thread.id)).toMatchObject({
        id: thread.id,
        status: "active",
        stopRequestedAt: expect.any(Number),
      });
      expect(
        getThreadOperation(harness.db, {
          threadId: thread.id,
          kind: "start",
        })?.state,
      ).toBe("requested");
    });
  });
});
