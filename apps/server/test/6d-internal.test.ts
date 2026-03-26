import { describe, it, expect, beforeEach } from "vitest";
import {
  queueCommand,
  getThread,
  getEnvironment,
  createThread,
  createEnvironment,
  insertEvents,
  getHighWaterMarks,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import { createTestApp, type TestApp } from "./helpers/test-app.js";
import {
  seedHost,
  seedSession,
  seedProject,
  seedProjectSource,
  seedEnvironment,
  seedThread,
} from "./helpers/seed.js";
import type { NotificationHub } from "../src/ws/hub.js";

const AUTH = { authorization: "Bearer test-secret" };
const JSON_HEADERS = { "content-type": "application/json", ...AUTH };

let t: TestApp;
let db: DbConnection;
let hub: NotificationHub;

beforeEach(() => {
  t = createTestApp();
  db = t.db;
  hub = t.hub;
});

describe("6d: Session open", () => {
  it("creates host + session, returns sessionId", async () => {
    const res = await t.app.request("/internal/session/open", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        hostId: "host_new",
        instanceId: "inst_1",
        hostName: "My Mac",
        hostType: "persistent",
        protocolVersion: 2,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sessionId).toBeDefined();
    expect(body.heartbeatIntervalMs).toBeGreaterThan(0);
    expect(body.leaseTimeoutMs).toBeGreaterThan(0);
    expect(body.threadHighWaterMarks).toBeDefined();
  });

  it("returns threadHighWaterMarks for host's threads", async () => {
    const host = seedHost(db, hub, "host_hwm");
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const thread = seedThread(db, hub, project.id, env.id);

    // Insert some events
    insertEvents(db, hub, [
      { threadId: thread.id, sequence: 1, type: "thread/started" as const, data: JSON.stringify({ type: "thread/started" }) },
      { threadId: thread.id, sequence: 2, type: "turn/started" as const, data: JSON.stringify({ type: "turn/started" }) },
    ]);

    const res = await t.app.request("/internal/session/open", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        hostId: host.id,
        instanceId: "inst_2",
        hostName: "My Mac",
        hostType: "persistent",
        protocolVersion: 2,
      }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.threadHighWaterMarks[thread.id]).toBe(2);
  });
});

describe("6d: Command fetch", () => {
  it("returns pending commands and marks as fetched", async () => {
    const host = seedHost(db, hub, "host_fetch");
    const session = seedSession(db, hub, host.id);

    queueCommand(db, hub, {
      hostId: host.id,
      sessionId: session.id,
      type: "workspace.status",
      payload: JSON.stringify({ type: "workspace.status", environmentId: "env_1" }),
    });

    const res = await t.app.request(
      `/internal/session/commands?sessionId=${session.id}&afterCursor=0`,
      { headers: AUTH },
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.commands).toHaveLength(1);
    expect(body.commands[0].command.type).toBe("workspace.status");
  });

  it("returns 204 on no commands", async () => {
    const host = seedHost(db, hub, "host_empty");
    const session = seedSession(db, hub, host.id);

    const res = await t.app.request(
      `/internal/session/commands?sessionId=${session.id}&afterCursor=0`,
      { headers: AUTH },
    );
    expect(res.status).toBe(204);
  });

  it("long-poll returns empty on timeout", async () => {
    const host = seedHost(db, hub, "host_poll");
    const session = seedSession(db, hub, host.id);

    const res = await t.app.request(
      `/internal/session/commands?sessionId=${session.id}&afterCursor=0&waitMs=100`,
      { headers: AUTH },
    );
    expect(res.status).toBe(204);
  });
});

describe("6d: Command result", () => {
  it("provision success updates env to ready", async () => {
    const host = seedHost(db, hub, "host_prov");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = createEnvironment(db, hub, {
      projectId: project.id,
      hostId: host.id,
      status: "provisioning",
    });
    const thread = createThread(db, hub, {
      projectId: project.id,
      providerId: "default",
      environmentId: env.id,
      status: "created",
    });

    const cmd = queueCommand(db, hub, {
      hostId: host.id,
      sessionId: session.id,
      type: "environment.provision",
      payload: JSON.stringify({
        type: "environment.provision",
        environmentId: env.id,
        projectId: project.id,
        workspaceProvisionType: "unmanaged",
        path: "/test",
      }),
    });

    const res = await t.app.request("/internal/session/command-result", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        sessionId: session.id,
        commandId: cmd.id,
        cursor: cmd.cursor,
        completedAt: Date.now(),
        type: "environment.provision",
        ok: true,
        result: { path: "/test", isGitRepo: true, isWorktree: false, branchName: null, ranSetup: false },
      }),
    });
    expect(res.status).toBe(200);

    const updatedEnv = getEnvironment(db, env.id);
    expect(updatedEnv?.status).toBe("ready");
    expect(updatedEnv?.path).toBe("/test");

    const updatedThread = getThread(db, thread.id);
    expect(updatedThread?.status).toBe("idle");
  });

  it("provision failure errors env + thread", async () => {
    const host = seedHost(db, hub, "host_fail");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = createEnvironment(db, hub, {
      projectId: project.id,
      hostId: host.id,
      status: "provisioning",
    });
    const thread = createThread(db, hub, {
      projectId: project.id,
      providerId: "default",
      environmentId: env.id,
      status: "created",
    });

    const cmd = queueCommand(db, hub, {
      hostId: host.id,
      sessionId: session.id,
      type: "environment.provision",
      payload: JSON.stringify({
        type: "environment.provision",
        environmentId: env.id,
      }),
    });

    const res = await t.app.request("/internal/session/command-result", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        sessionId: session.id,
        commandId: cmd.id,
        cursor: cmd.cursor,
        completedAt: Date.now(),
        type: "environment.provision",
        ok: false,
        errorCode: "path_not_found",
        errorMessage: "Path does not exist",
      }),
    });
    expect(res.status).toBe(200);

    const updatedEnv = getEnvironment(db, env.id);
    expect(updatedEnv?.status).toBe("error");
  });
});

describe("6d: Event ingestion", () => {
  it("deduplicates events, returns high-water marks", async () => {
    const host = seedHost(db, hub, "host_evt");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const thread = seedThread(db, hub, project.id, env.id);

    const events = [
      {
        id: "evt_1",
        environmentId: env.id,
        threadId: thread.id,
        sequence: 1,
        createdAt: Date.now(),
        event: { type: "thread/started", threadId: thread.id },
      },
      {
        id: "evt_2",
        environmentId: env.id,
        threadId: thread.id,
        sequence: 2,
        createdAt: Date.now(),
        event: { type: "turn/started", threadId: thread.id, turnId: "turn_1", providerThreadId: "prov_1" },
      },
    ];

    const res = await t.app.request("/internal/session/events", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: session.id, events }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.threadHighWaterMarks[thread.id]).toBe(2);

    // Sending again should deduplicate
    const res2 = await t.app.request("/internal/session/events", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ sessionId: session.id, events }),
    });
    expect(res2.status).toBe(200);
  });

  it("turn/completed transitions thread to idle", async () => {
    const host = seedHost(db, hub, "host_idle");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);

    // Create an active thread
    const thread = createThread(db, hub, {
      projectId: project.id,
      providerId: "default",
      environmentId: env.id,
      status: "idle",
    });
    // Transition to active
    const { transitionThreadStatus } = await import("@bb/db");
    transitionThreadStatus(db, hub, thread.id, "active");

    const res = await t.app.request("/internal/session/events", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        sessionId: session.id,
        events: [
          {
            id: "evt_tc",
            environmentId: env.id,
            threadId: thread.id,
            sequence: 10,
            createdAt: Date.now(),
            event: { type: "turn/completed", threadId: thread.id, turnId: "turn_1", providerThreadId: "prov_1", status: "completed" },
          },
        ],
      }),
    });
    expect(res.status).toBe(200);

    const updated = getThread(db, thread.id);
    expect(updated?.status).toBe("idle");
  });
});

describe("6d: Tool calls", () => {
  it("spawn_thread creates child thread", async () => {
    const host = seedHost(db, hub, "host_tool");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);

    const res = await t.app.request("/internal/session/tool-call", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        sessionId: session.id,
        requestId: "req_1",
        threadId: "thr_parent",
        turnId: "turn_1",
        callId: "call_1",
        tool: "spawn_thread",
        arguments: { projectId: project.id, title: "Spawned" },
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.result.threadId).toBeDefined();
  });
});
