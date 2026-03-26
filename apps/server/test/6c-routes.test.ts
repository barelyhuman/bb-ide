import { describe, it, expect, beforeEach } from "vitest";
import { fetchCommands } from "@bb/db";
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

let t: TestApp;
let db: DbConnection;
let hub: NotificationHub;

beforeEach(() => {
  t = createTestApp();
  db = t.db;
  hub = t.hub;
});

describe("6c: Projects", () => {
  it("CRUD for projects", async () => {
    const host = seedHost(db, hub, "host_1");

    // Create
    const createRes = await t.app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "My Project", hostId: host.id, sourcePath: "/code" }),
    });
    expect(createRes.status).toBe(201);
    const project = await createRes.json();
    expect(project.name).toBe("My Project");
    expect(project.sources).toHaveLength(1);

    // Get
    const getRes = await t.app.request(`/api/v1/projects/${project.id}`);
    expect(getRes.status).toBe(200);

    // List
    const listRes = await t.app.request("/api/v1/projects");
    expect(listRes.status).toBe(200);
    const projects = await listRes.json();
    expect(projects).toHaveLength(1);

    // Update
    const patchRes = await t.app.request(`/api/v1/projects/${project.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated" }),
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.name).toBe("Updated");

    // Delete
    const delRes = await t.app.request(`/api/v1/projects/${project.id}`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
  });
});

describe("6c: Hosts", () => {
  it("lists and gets hosts", async () => {
    seedHost(db, hub, "host_test");

    const listRes = await t.app.request("/api/v1/hosts");
    expect(listRes.status).toBe(200);
    const hosts = await listRes.json();
    expect(hosts).toHaveLength(1);
    expect(hosts[0].status).toBe("disconnected");

    const getRes = await t.app.request(`/api/v1/hosts/${hosts[0].id}`);
    expect(getRes.status).toBe(200);
  });
});

describe("6c: Threads", () => {
  it("POST /threads with sandbox-host returns 501", async () => {
    const host = seedHost(db, hub, "host_s");
    const project = seedProject(db, hub);
    seedProjectSource(db, hub, project.id, host.id);

    const res = await t.app.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        providerId: "default",
        environment: { type: "sandbox-host", sandboxType: "e2b" },
      }),
    });
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.code).toBe("unsupported_operation");
  });

  it("POST /threads with reuse creates thread with existing env", async () => {
    const host = seedHost(db, hub, "host_r");
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);

    const res = await t.app.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        providerId: "default",
        environment: { type: "reuse", environmentId: env.id },
      }),
    });
    expect(res.status).toBe(201);
    const thread = await res.json();
    expect(thread.projectId).toBe(project.id);
  });

  it("POST /threads with host+unmanaged queues provision command", async () => {
    const host = seedHost(db, hub, "host_u");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    seedProjectSource(db, hub, project.id, host.id);
    // Connect the daemon so the command can be queued
    const ws = { send: () => {}, close: () => {} } as unknown as import("hono/ws").WSContext;
    hub.addDaemon(session.id, host.id, ws);

    const res = await t.app.request("/api/v1/threads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: project.id,
        providerId: "default",
        environment: {
          type: "host",
          hostId: host.id,
          workspace: { type: "unmanaged", path: "/my/code" },
        },
      }),
    });
    expect(res.status).toBe(201);

    // Verify provision command was queued
    const commands = fetchCommands(db, hub, { hostId: host.id });
    expect(commands.length).toBeGreaterThan(0);
    const provisionCmd = commands.find((c) => c.type === "environment.provision");
    expect(provisionCmd).toBeDefined();
  });

  it("POST /threads/:id/send idle → turn.run queued", async () => {
    const host = seedHost(db, hub, "host_send");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const thread = seedThread(db, hub, project.id, env.id);
    const ws = { send: () => {}, close: () => {} } as unknown as import("hono/ws").WSContext;
    hub.addDaemon(session.id, host.id, ws);

    const res = await t.app.request(`/api/v1/threads/${thread.id}/send`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: [{ type: "text", text: "Hello" }],
      }),
    });
    expect(res.status).toBe(200);

    const commands = fetchCommands(db, hub, { hostId: host.id });
    const turnCmd = commands.find((c) => c.type === "turn.run");
    expect(turnCmd).toBeDefined();
  });

  it("POST /threads/:id/archive archives the thread", async () => {
    const host = seedHost(db, hub, "host_arch");
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const thread = seedThread(db, hub, project.id, env.id);

    const res = await t.app.request(`/api/v1/threads/${thread.id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });
    expect(res.status).toBe(200);
  });

  it("POST /threads/:id/unarchive clears archivedAt", async () => {
    const host = seedHost(db, hub, "host_una");
    const project = seedProject(db, hub);
    const thread = seedThread(db, hub, project.id);

    // Archive first
    await t.app.request(`/api/v1/threads/${thread.id}/archive`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    const res = await t.app.request(`/api/v1/threads/${thread.id}/unarchive`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
  });

  it("GET /threads/:id/events returns events", async () => {
    const project = seedProject(db, hub);
    const thread = seedThread(db, hub, project.id);

    const res = await t.app.request(`/api/v1/threads/${thread.id}/events`);
    expect(res.status).toBe(200);
    const events = await res.json();
    expect(Array.isArray(events)).toBe(true);
  });

  it("GET /system/config returns config", async () => {
    const res = await t.app.request("/api/v1/system/config");
    expect(res.status).toBe(200);
    const config = await res.json();
    expect(config).toHaveProperty("hostDaemonPort");
  });

  it("PATCH /threads/:id with title change queues rename", async () => {
    const host = seedHost(db, hub, "host_rename");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const thread = seedThread(db, hub, project.id, env.id);
    const ws = { send: () => {}, close: () => {} } as unknown as import("hono/ws").WSContext;
    hub.addDaemon(session.id, host.id, ws);

    const res = await t.app.request(`/api/v1/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New Title" }),
    });
    expect(res.status).toBe(200);

    const commands = fetchCommands(db, hub, { hostId: host.id });
    const renameCmd = commands.find((c) => c.type === "thread.rename");
    expect(renameCmd).toBeDefined();
  });

  it("DELETE /threads/:id with managed environment queues destroy", async () => {
    const host = seedHost(db, hub, "host_del");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const { createEnvironment } = await import("@bb/db");
    const env = createEnvironment(db, hub, {
      projectId: project.id,
      hostId: host.id,
      path: "/managed/ws",
      managed: true,
      status: "ready",
    });
    const thread = seedThread(db, hub, project.id, env.id);
    const ws = { send: () => {}, close: () => {} } as unknown as import("hono/ws").WSContext;
    hub.addDaemon(session.id, host.id, ws);

    const res = await t.app.request(`/api/v1/threads/${thread.id}`, {
      method: "DELETE",
    });
    expect(res.status).toBe(200);

    const commands = fetchCommands(db, hub, { hostId: host.id });
    const destroyCmd = commands.find((c) => c.type === "environment.destroy");
    expect(destroyCmd).toBeDefined();
  });

  it("POST /threads/:id/stop queues stop command", async () => {
    const host = seedHost(db, hub, "host_stop");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const thread = seedThread(db, hub, project.id, env.id);
    const ws = { send: () => {}, close: () => {} } as unknown as import("hono/ws").WSContext;
    hub.addDaemon(session.id, host.id, ws);

    // Kick off a stop (won't wait for result since we resolve it)
    const stopPromise = t.app.request(`/api/v1/threads/${thread.id}/stop`, {
      method: "POST",
    });

    // Resolve the command result so the await doesn't hang
    setTimeout(() => {
      const commands = fetchCommands(db, hub, { hostId: host.id });
      const stopCmd = commands.find((c) => c.type === "thread.stop");
      if (stopCmd) {
        hub.resolveCommandResult(stopCmd.id, { ok: true, result: {} });
      }
    }, 50);

    const res = await stopPromise;
    expect(res.status).toBe(200);
  });
});

describe("6c: Environment actions", () => {
  it("POST /environments/:id/actions commit queues workspace.commit", async () => {
    const host = seedHost(db, hub, "host_commit");
    const session = seedSession(db, hub, host.id);
    const project = seedProject(db, hub);
    const env = seedEnvironment(db, hub, project.id, host.id);
    const ws = { send: () => {}, close: () => {} } as unknown as import("hono/ws").WSContext;
    hub.addDaemon(session.id, host.id, ws);

    const commitPromise = t.app.request(`/api/v1/environments/${env.id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "commit", options: { message: "test commit" } }),
    });

    setTimeout(() => {
      const commands = fetchCommands(db, hub, { hostId: host.id });
      const cmd = commands.find((c) => c.type === "workspace.commit");
      if (cmd) {
        hub.resolveCommandResult(cmd.id, {
          ok: true,
          result: { commitSha: "abc123", commitSubject: "test" },
        });
      }
    }, 50);

    const res = await commitPromise;
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.action).toBe("commit");
    expect(body.commitCreated).toBe(true);
  });
});
