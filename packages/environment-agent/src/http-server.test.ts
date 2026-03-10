import { afterEach, describe, expect, it } from "vitest";
import { createEnvironmentAgentHttpServer } from "./http-server.js";
import { EnvironmentAgentRuntime } from "./runtime.js";

describe("environment-agent HTTP transport", () => {
  const cleanup: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      const fn = cleanup.pop();
      await fn?.();
    }
  });

  it("serves status over HTTP", async () => {
    const runtime = new EnvironmentAgentRuntime({
      threadId: "thread-1",
      providerCommand: "codex",
      providerArgs: ["app-server"],
    });
    runtime.appendEvent({
      type: "environment.ready",
      threadId: "thread-1",
    });
    const server = await createEnvironmentAgentHttpServer({
      runtime,
      bearerToken: "test-token",
    });
    cleanup.push(() => server.close());
    const response = await fetch(`${server.baseUrl}/control/status`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-token",
        "content-type": "application/json",
      },
      body: "{}",
    });

    await expect(response.json()).resolves.toMatchObject({
      latestSequence: 1,
      pendingEventCount: 1,
    });
  });

  it("rejects unauthenticated requests", async () => {
    const runtime = new EnvironmentAgentRuntime({
      threadId: "thread-1",
    });
    runtime.start();
    const server = await createEnvironmentAgentHttpServer({
      runtime,
      bearerToken: "test-token",
    });
    cleanup.push(() => server.close());

    const response = await fetch(`${server.baseUrl}/control/status`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: "{}",
    });

    expect(response.status).toBe(401);
  });
});
