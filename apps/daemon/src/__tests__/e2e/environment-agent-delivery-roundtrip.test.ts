import { afterEach, describe, expect, it } from "vitest";
import type {
  EnvironmentAgentDeliveryRequest,
  EnvironmentAgentDeliveryResponse,
} from "@beanbag/environment-agent";
import type { Project, Thread, ThreadEvent } from "@beanbag/agent-core";
import {
  startDaemonE2eHarness,
  type DaemonE2eHarness,
} from "./harness.js";

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body || response.statusText}`);
  }
  return (await response.json()) as T;
}

async function createProject(baseUrl: string, rootPath: string): Promise<Project> {
  return readJson<Project>(`${baseUrl}/api/v1/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "e2e-env-agent-delivery-project",
      rootPath,
    }),
  });
}

async function createThread(baseUrl: string, projectId: string): Promise<Thread> {
  return readJson<Thread>(`${baseUrl}/api/v1/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      projectId,
      input: [{ type: "text", text: "Prepare a thread for environment-agent delivery e2e." }],
    }),
  });
}

async function waitForThreadStatus(
  baseUrl: string,
  threadId: string,
  expectedStatus: Thread["status"],
  timeoutMs: number = 5_000,
): Promise<Thread> {
  const deadline = Date.now() + timeoutMs;
  let lastThread: Thread | undefined;

  while (Date.now() < deadline) {
    const thread = await readJson<Thread>(`${baseUrl}/api/v1/threads/${threadId}`);
    lastThread = thread;
    if (thread.status === expectedStatus) {
      return thread;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  throw new Error(
    `Thread ${threadId} did not reach ${expectedStatus} (last status=${lastThread?.status ?? "unknown"})`,
  );
}

async function listEvents(baseUrl: string, threadId: string): Promise<ThreadEvent[]> {
  return readJson<ThreadEvent[]>(`${baseUrl}/api/v1/threads/${threadId}/events`);
}

describe.sequential("e2e: environment-agent delivery", () => {
  let harness: DaemonE2eHarness | undefined;

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
      harness = undefined;
    }
  });

  it(
    "accepts authenticated delivery, updates thread state, and ignores duplicate sequences",
    async () => {
      harness = await startDaemonE2eHarness();

      const project = await createProject(harness.baseUrl, harness.projectRoot);
      const thread = await createThread(harness.baseUrl, project.id);
      await waitForThreadStatus(harness.baseUrl, thread.id, "idle");

      const authorization = harness.getEnvironmentAgentAuthorization(thread.id);
      expect(authorization).toMatch(/^Bearer /);

      const nextSequence = harness.getEnvironmentAgentCursor(thread.id) + 1;
      const initialEvents = await listEvents(harness.baseUrl, thread.id);
      const initialTurnStartedCount = initialEvents.filter(
        (event) => event.type === "turn/started",
      ).length;
      const initialTurnCompletedCount = initialEvents.filter(
        (event) => event.type === "turn/completed",
      ).length;

      const turnStartedDelivery: EnvironmentAgentDeliveryRequest = {
        protocolVersion: 1,
        threadId: thread.id,
        events: [
          {
            protocolVersion: 1,
            sequence: nextSequence,
            emittedAt: 1_000 + nextSequence,
            threadId: thread.id,
            event: {
              type: "provider.event",
              threadId: thread.id,
              method: "turn/started",
              payload: { turnId: "turn-e2e" },
            },
          },
        ],
      };

      const delivered = await readJson<EnvironmentAgentDeliveryResponse>(
        `${harness.baseUrl}/api/v1/threads/${thread.id}/environment-agent/deliver`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: authorization!,
          },
          body: JSON.stringify(turnStartedDelivery),
        },
      );
      expect(delivered.acknowledgedSequence).toBe(nextSequence);

      await waitForThreadStatus(harness.baseUrl, thread.id, "active");
      const afterStartedEvents = await listEvents(harness.baseUrl, thread.id);
      expect(
        afterStartedEvents.filter((event) => event.type === "turn/started"),
      ).toHaveLength(initialTurnStartedCount + 1);

      const duplicate = await readJson<EnvironmentAgentDeliveryResponse>(
        `${harness.baseUrl}/api/v1/threads/${thread.id}/environment-agent/deliver`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: authorization!,
          },
          body: JSON.stringify(turnStartedDelivery),
        },
      );
      expect(duplicate.acknowledgedSequence).toBe(nextSequence);

      const afterDuplicateEvents = await listEvents(harness.baseUrl, thread.id);
      expect(
        afterDuplicateEvents.filter((event) => event.type === "turn/started"),
      ).toHaveLength(initialTurnStartedCount + 1);

      const turnCompletedDelivery: EnvironmentAgentDeliveryRequest = {
        protocolVersion: 1,
        threadId: thread.id,
        events: [
          {
            protocolVersion: 1,
            sequence: nextSequence + 1,
            emittedAt: 1_001 + nextSequence,
            threadId: thread.id,
            event: {
              type: "provider.event",
              threadId: thread.id,
              method: "turn/completed",
              payload: { turnId: "turn-e2e" },
            },
          },
        ],
      };

      const completed = await readJson<EnvironmentAgentDeliveryResponse>(
        `${harness.baseUrl}/api/v1/threads/${thread.id}/environment-agent/deliver`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: authorization!,
          },
          body: JSON.stringify(turnCompletedDelivery),
        },
      );
      expect(completed.acknowledgedSequence).toBe(nextSequence + 1);

      await waitForThreadStatus(harness.baseUrl, thread.id, "idle");
      const finalEvents = await listEvents(harness.baseUrl, thread.id);
      expect(
        finalEvents.filter((event) => event.type === "turn/completed"),
      ).toHaveLength(initialTurnCompletedCount + 1);
    },
    15_000,
  );
});
