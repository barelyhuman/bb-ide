import { describe, it, expect, vi } from "vitest";
import { NotificationHub } from "../src/ws/hub.js";
import type { WSContext } from "hono/ws";

function createMockWs(): WSContext & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    send(data: string | ArrayBuffer) {
      messages.push(typeof data === "string" ? data : "binary");
    },
    close: vi.fn(),
    readyState: 1,
    raw: {} as unknown,
    url: null,
    protocol: null,
    binaryType: "arraybuffer",
  } as unknown as WSContext & { messages: string[] };
}

describe("6b: NotificationHub", () => {
  it("broadcasts to subscribed clients", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    hub.addClient(ws);
    hub.subscribe(ws, "thread", "thr_123");
    hub.notifyThread("thr_123", ["events-appended"]);

    expect(ws.messages).toHaveLength(1);
    const msg = JSON.parse(ws.messages[0]);
    expect(msg).toEqual({
      type: "changed",
      entity: "thread",
      id: "thr_123",
      changes: ["events-appended"],
    });
  });

  it("does not send to unsubscribed clients", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    hub.addClient(ws);
    hub.subscribe(ws, "thread", "thr_123");
    hub.unsubscribe(ws, "thread", "thr_123");
    hub.notifyThread("thr_123", ["events-appended"]);

    expect(ws.messages).toHaveLength(0);
  });

  it("cleans up subscriptions on client disconnect", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    hub.addClient(ws);
    hub.subscribe(ws, "thread", "thr_123");
    hub.removeClient(ws);
    hub.notifyThread("thr_123", ["events-appended"]);

    expect(ws.messages).toHaveLength(0);
  });

  it("sends commands-available to correct daemon", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    hub.addDaemon("session_1", "host_1", ws);
    hub.notifyCommand("host_1");

    expect(ws.messages).toHaveLength(1);
    expect(JSON.parse(ws.messages[0])).toEqual({ type: "commands-available" });
  });

  it("notifyCommand for unknown host is a no-op", () => {
    const hub = new NotificationHub();
    // Should not throw
    hub.notifyCommand("unknown_host");
  });

  it("multiple clients subscribed to same thread all receive notification", () => {
    const hub = new NotificationHub();
    const ws1 = createMockWs();
    const ws2 = createMockWs();

    hub.addClient(ws1);
    hub.addClient(ws2);
    hub.subscribe(ws1, "thread", "thr_1");
    hub.subscribe(ws2, "thread", "thr_1");
    hub.notifyThread("thr_1", ["status-changed"]);

    expect(ws1.messages).toHaveLength(1);
    expect(ws2.messages).toHaveLength(1);
  });

  it("waitForCommandResult resolves when result arrives", async () => {
    const hub = new NotificationHub();

    const promise = hub.waitForCommandResult("cmd_1", 5000);
    hub.resolveCommandResult("cmd_1", { ok: true, result: { foo: "bar" } });

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.result).toEqual({ foo: "bar" });
  });

  it("waitForCommandResult times out", async () => {
    const hub = new NotificationHub();

    const result = await hub.waitForCommandResult("cmd_timeout", 50);
    expect(result.ok).toBe(false);
    expect(result.errorCode).toBe("command_timeout");
  });

  it("waitForCommands resolves when notifyCommand fires", async () => {
    const hub = new NotificationHub();

    const promise = hub.waitForCommands("host_1", 5000);
    // Simulate daemon connecting
    const ws = createMockWs();
    hub.addDaemon("session_1", "host_1", ws);
    hub.notifyCommand("host_1");

    await promise; // Should resolve without timing out
  });

  it("notifyProject broadcasts to project subscribers", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    hub.addClient(ws);
    hub.subscribe(ws, "project", "proj_1");
    hub.notifyProject("proj_1", ["sources-changed"]);

    expect(ws.messages).toHaveLength(1);
    const msg = JSON.parse(ws.messages[0]);
    expect(msg.entity).toBe("project");
    expect(msg.id).toBe("proj_1");
  });

  it("notifySystem broadcasts to system subscribers", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    hub.addClient(ws);
    hub.subscribe(ws, "system");
    hub.notifySystem(["host-connected"]);

    expect(ws.messages).toHaveLength(1);
    const msg = JSON.parse(ws.messages[0]);
    expect(msg.entity).toBe("system");
    expect(msg.changes).toEqual(["host-connected"]);
  });

  it("isDaemonConnected returns true for connected daemon", () => {
    const hub = new NotificationHub();
    const ws = createMockWs();

    expect(hub.isDaemonConnected("host_1")).toBe(false);
    hub.addDaemon("session_1", "host_1", ws);
    expect(hub.isDaemonConnected("host_1")).toBe(true);
    hub.removeDaemon("session_1");
    expect(hub.isDaemonConnected("host_1")).toBe(false);
  });
});
