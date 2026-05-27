import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

describe("internal STATUS-data change route", () => {
  it("broadcasts daemon-reported STATUS-data changes for session-owned threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-status-data-change",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
        path: "/tmp/status-data-change",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const notifyThreadStatusDataSpy = vi.spyOn(
        harness.hub,
        "notifyThreadStatusData",
      );

      const response = await harness.app.request(
        "/internal/session/status-data-change",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: session.id,
            threadId: thread.id,
            key: "state",
            value: { status: "running" },
            deleted: false,
            previousValue: { status: "queued" },
            previousValuePresent: true,
            version: "version-next",
            previousVersion: "version-prev",
          }),
        },
      );

      expect(response.status).toBe(200);
      expect(notifyThreadStatusDataSpy).toHaveBeenCalledWith({
        type: "status-data.changed",
        threadId: thread.id,
        key: "state",
        value: { status: "running" },
        deleted: false,
        previousValue: { status: "queued" },
        previousValuePresent: true,
        version: "version-next",
        writerClientId: null,
        operationId: null,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects daemon-reported STATUS-data changes for threads owned by another host", async () => {
    const harness = await createTestAppHarness();
    try {
      const hostA = seedHostSession(harness.deps, {
        id: "host-status-data-change-a",
      });
      const hostB = seedHostSession(harness.deps, {
        id: "host-status-data-change-b",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: hostB.host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: hostB.host.id,
        projectId: project.id,
        path: "/tmp/status-data-change-other",
        status: "ready",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const notifyThreadStatusDataSpy = vi.spyOn(
        harness.hub,
        "notifyThreadStatusData",
      );

      const response = await harness.app.request(
        "/internal/session/status-data-change",
        {
          method: "POST",
          headers: internalAuthHeaders(harness),
          body: JSON.stringify({
            sessionId: hostA.session.id,
            threadId: thread.id,
            key: "state",
            value: null,
            deleted: true,
            previousValue: { status: "running" },
            previousValuePresent: true,
            version: null,
            previousVersion: "version-prev",
          }),
        },
      );

      expect(response.status).toBe(403);
      await expect(readJson(response)).resolves.toMatchObject({
        code: "invalid_request",
      });
      expect(notifyThreadStatusDataSpy).not.toHaveBeenCalled();
    } finally {
      await harness.cleanup();
    }
  });
});
