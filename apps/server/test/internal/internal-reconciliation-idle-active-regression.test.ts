import { getThread, getThreadOperation, markThreadStopRequested } from "@bb/db";
import { upsertThreadOperationRecord } from "@bb/db/internal-lifecycle";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
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
