import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ThreadEvent } from "@bb/domain";
import { createAgentRuntime } from "./runtime.js";
import { fakeProviderScriptPath } from "./test/index.js";
import {
  createFakeAdapter,
  createStartedEventAdapter,
  createWarningEventAdapter,
  fullRuntimeOptions,
  wait,
} from "./test/runtime-test-harness.js";

describe("createAgentRuntime multi-thread routing", () => {
  let tmpDir: string;
  let scriptPath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "bb-runtime-test-"));
    scriptPath = fakeProviderScriptPath;
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("handles multiple threads on the same provider", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    const r1 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    const r2 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    // Each thread gets a unique providerThreadId
    expect(r1.providerThreadId).not.toBe(r2.providerThreadId);

    // Run turns concurrently
    await Promise.all([
      runtime.runTurn({ threadId: "t1", input: [{ type: "text", text: "thread 1" }], options: fullRuntimeOptions }),
      runtime.runTurn({ threadId: "t2", input: [{ type: "text", text: "thread 2" }], options: fullRuntimeOptions }),
    ]);
    await wait(100);

    // Both threads should have turn/completed events with correct threadIds
    const t1Completed = events.filter(
      (e) => e.type === "turn/completed" && "threadId" in e && e.threadId === "t1",
    );
    const t2Completed = events.filter(
      (e) => e.type === "turn/completed" && "threadId" in e && e.threadId === "t2",
    );
    expect(t1Completed.length).toBe(1);
    expect(t2Completed.length).toBe(1);

    await runtime.shutdown();
  });

  it("stamps all events with bb threadId and providerThreadId", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    const { providerThreadId } = await runtime.startThread({
      environmentId: "env-1",
      threadId: "my-thread",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime.runTurn({
      threadId: "my-thread",
      input: [{ type: "text", text: "check ids" }],
      options: fullRuntimeOptions,
    });
    await wait(100);

    // Every event with a threadId should have the bb threadId, not the provider's
    const threadEvents = events.filter((e) => "threadId" in e);
    expect(threadEvents.length).toBeGreaterThan(0);
    for (const e of threadEvents) {
      expect(e.threadId).toBe("my-thread");
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(providerThreadId);
      }
    }

    await runtime.shutdown();
  });

  it("stamps events correctly for multiple threads", async () => {
    const events: ThreadEvent[] = [];
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    const r1 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    const r2 = await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({ threadId: "t1", input: [{ type: "text", text: "from t1" }], options: fullRuntimeOptions }),
      runtime.runTurn({ threadId: "t2", input: [{ type: "text", text: "from t2" }], options: fullRuntimeOptions }),
    ]);
    await wait(100);

    // t1 events should have threadId "t1" and providerThreadId from r1
    const t1Events = events.filter(
      (e) => "threadId" in e && e.threadId === "t1",
    );
    const t2Events = events.filter(
      (e) => "threadId" in e && e.threadId === "t2",
    );

    expect(t1Events.length).toBeGreaterThan(0);
    expect(t2Events.length).toBeGreaterThan(0);

    for (const e of t1Events) {
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(r1.providerThreadId);
      }
    }
    for (const e of t2Events) {
      if ("providerThreadId" in e) {
        expect(e.providerThreadId).toBe(r2.providerThreadId);
      }
    }

    await runtime.shutdown();
  });

  it("maps thread/started before identity for multiple threads on one provider", async () => {
    const events: ThreadEvent[] = [];
    const startedScriptPath = join(tmpDir, "started-provider.cjs");
    writeFileSync(
      startedScriptPath,
      `
let nextThreadId = 1;
const readline = require("node:readline");

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  if (message.method === "thread/start") {
    const providerThreadId = "prov-" + String(nextThreadId++);
    send({
      jsonrpc: "2.0",
      method: "thread/started",
      params: {
        thread: {
          id: providerThreadId,
        },
      },
    });
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId },
    });
  }
});
`,
      "utf8",
    );

    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (event) => events.push(event),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createStartedEventAdapter(startedScriptPath),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "started-fake",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "started-fake",
      options: fullRuntimeOptions,
    });
    await wait(50);

    expect(
      events.filter(
        (event) => event.type === "thread/started" && event.threadId === "t1",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === "thread/started" && event.threadId === "t2",
      ),
    ).toHaveLength(1);
    expect(
      events.some(
        (event) =>
          event.type === "thread/started" && event.threadId.startsWith("prov-"),
      ),
    ).toBe(false);

    await runtime.shutdown();
  });

  it("drops unscoped provider events when multiple threads share one provider", async () => {
    const events: ThreadEvent[] = [];
    const warningScriptPath = join(tmpDir, "warning-provider.cjs");
    writeFileSync(
      warningScriptPath,
      `
let nextThreadId = 1;
const readline = require("node:readline");

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\\n");
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    send({ jsonrpc: "2.0", id: message.id, result: {} });
    return;
  }

  if (message.method === "thread/start") {
    const providerThreadId = "prov-" + String(nextThreadId++);
    send({
      jsonrpc: "2.0",
      id: message.id,
      result: { providerThreadId },
    });
    return;
  }

  if (message.method === "turn/start") {
    const providerThreadId = message.params.threadId;
    const turnId = "turn-" + providerThreadId;
    send({ jsonrpc: "2.0", method: "warning", params: {} });
    send({
      jsonrpc: "2.0",
      method: "turn/started",
      params: { threadId: providerThreadId, providerThreadId, turnId },
    });
    send({
      jsonrpc: "2.0",
      method: "turn/completed",
      params: { threadId: providerThreadId, providerThreadId, turnId },
    });
    send({ jsonrpc: "2.0", id: message.id, result: {} });
  }
});
`,
      "utf8",
    );

    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createWarningEventAdapter(warningScriptPath),
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "warning-fake",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "warning-fake",
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({
        threadId: "t1",
        input: [{ type: "text", text: "from t1" }],
        options: fullRuntimeOptions,
      }),
      runtime.runTurn({
        threadId: "t2",
        input: [{ type: "text", text: "from t2" }],
        options: fullRuntimeOptions,
      }),
    ]);
    await wait(100);

    expect(events.find((event) => event.type === "warning")).toBeUndefined();
    expect(
      events.filter(
        (event) => event.type === "turn/completed" && event.threadId === "t1",
      ),
    ).toHaveLength(1);
    expect(
      events.filter(
        (event) => event.type === "turn/completed" && event.threadId === "t2",
      ),
    ).toHaveLength(1);

    await runtime.shutdown();
  });

  // ---- Multi-provider ----

  it("handles multiple providers in a single runtime", async () => {
    const events: ThreadEvent[] = [];
    // Create two different fake provider scripts with distinct responses
    const script2 = join(tmpDir, "fake-provider-2.cjs");
    writeFileSync(script2, readFileSync(fakeProviderScriptPath, "utf8"));

    let adapterCallCount = 0;
    const runtime = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: (providerId) => {
        adapterCallCount++;
        const adapter = createFakeAdapter(
          adapterCallCount === 1 ? scriptPath : script2,
        );
        return { ...adapter, id: providerId };
      },
    });

    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "provider-a",
      options: fullRuntimeOptions,
    });
    await runtime.startThread({
      environmentId: "env-1",
      threadId: "t2",
      projectId: "p1",
      providerId: "provider-b",
      options: fullRuntimeOptions,
    });

    await Promise.all([
      runtime.runTurn({ threadId: "t1", input: [{ type: "text", text: "from a" }], options: fullRuntimeOptions }),
      runtime.runTurn({ threadId: "t2", input: [{ type: "text", text: "from b" }], options: fullRuntimeOptions }),
    ]);
    await wait(100);

    const completedEvents = events.filter((e) => e.type === "turn/completed");
    expect(completedEvents.length).toBe(2);

    await runtime.shutdown();
  });

  // ---- Resume across runtimes ----

  it("resumes across runtime instances", async () => {
    // Runtime 1: start a thread
    const events1: ThreadEvent[] = [];
    const runtime1 = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events1.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    const { providerThreadId } = await runtime1.startThread({
      environmentId: "env-1",
      threadId: "t1",
      projectId: "p1",
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime1.runTurn({ threadId: "t1", input: [{ type: "text", text: "first runtime" }], options: fullRuntimeOptions });
    await wait(100);
    await runtime1.shutdown();

    // Runtime 2: resume the thread
    const events2: ThreadEvent[] = [];
    const runtime2 = createAgentRuntime({
      workspacePath: tmpDir,
      onEvent: (e) => events2.push(e),
      onToolCall: async () => ({
        contentItems: [{ type: "inputText", text: "ok" }],
        success: true,
      }),
      adapterFactory: () => createFakeAdapter(scriptPath),
    });

    await runtime2.resumeThread({
      environmentId: "env-1",
      threadId: "t1-resumed",
      providerThreadId,
      providerId: "fake",
      options: fullRuntimeOptions,
    });
    await runtime2.runTurn({
      threadId: "t1-resumed",
      input: [{ type: "text", text: "second runtime" }],
      options: fullRuntimeOptions,
    });
    await wait(100);

    expect(events2.some((e) => e.type === "turn/completed")).toBe(true);
    await runtime2.shutdown();
  });});
