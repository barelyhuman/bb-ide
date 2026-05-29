import { describe, expect, it } from "vitest";
import { getCommand, getThread, getThreadOperation, listEvents } from "@bb/db";
import type { ThreadEventType } from "@bb/domain";
import {
  finalizeStoppedThread,
  interruptActiveTurnForThread,
  requestThreadStop,
} from "../../src/services/threads/thread-lifecycle.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedTurnStarted,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

type ListedEvent = ReturnType<typeof listEvents>[number];

interface ActiveThreadWithTurnFixture {
  environmentId: string;
  hostId: string;
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

function seedActiveThreadWithTurn(
  harness: TestAppHarness,
): ActiveThreadWithTurnFixture {
  const { host } = seedHostSession(harness.deps, {
    id: "host-thread-lifecycle-interrupt",
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
  const turnId = "turn-thread-lifecycle-interrupt";
  const providerThreadId = "provider-thread-lifecycle-interrupt";
  seedTurnStarted(harness.deps, {
    threadId: thread.id,
    environmentId: environment.id,
    turnId,
    providerThreadId,
  });

  return {
    environmentId: environment.id,
    hostId: host.id,
    providerThreadId,
    threadId: thread.id,
    turnId,
  };
}

function getSingleEvent(
  events: ListedEvent[],
  type: ThreadEventType,
): ListedEvent {
  const matches = events.filter((event) => event.type === type);
  expect(matches).toHaveLength(1);
  const event = matches[0];
  if (!event) {
    throw new Error(`Expected one ${type} event`);
  }
  return event;
}

describe("thread lifecycle interruption", () => {
  it("interrupts an active turn with provider state and idles the thread", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedActiveThreadWithTurn(harness);

      expect(
        interruptActiveTurnForThread(harness.deps, {
          environmentId: fixture.environmentId,
          reason: "manual-stop",
          threadId: fixture.threadId,
        }),
      ).toBe(true);

      expect(getThread(harness.db, fixture.threadId)?.status).toBe("idle");
      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ]);

      const turnCompleted = getSingleEvent(events, "turn/completed");
      expect(turnCompleted).toMatchObject({
        environmentId: fixture.environmentId,
        providerThreadId: fixture.providerThreadId,
        scopeKind: "turn",
        turnId: fixture.turnId,
      });
      expect(turnCompleted.data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );

      const interrupted = getSingleEvent(events, "system/thread/interrupted");
      expect(interrupted).toMatchObject({
        providerThreadId: null,
        scopeKind: "thread",
        turnId: null,
      });
      expect(interrupted.data).toBe(
        JSON.stringify({
          reason: "manual-stop",
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("does not mutate an active thread when no active turn exists", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-lifecycle-no-turn",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
      });

      expect(
        interruptActiveTurnForThread(harness.deps, {
          environmentId: null,
          reason: "manual-stop",
          threadId: thread.id,
        }),
      ).toBe(false);

      expect(getThread(harness.db, thread.id)?.status).toBe("active");
      expect(listEvents(harness.db, { threadId: thread.id })).toEqual([]);
    } finally {
      await harness.cleanup();
    }
  });

  it("finalizes a stopped active thread with one interrupted turn and thread event", async () => {
    const harness = await createTestAppHarness();
    try {
      const fixture = seedActiveThreadWithTurn(harness);
      requestThreadStop(harness.deps, {
        environmentId: fixture.environmentId,
        hostId: fixture.hostId,
        stopRequestedAt: null,
        threadId: fixture.threadId,
      });
      const queuedStop = getThreadOperation(harness.db, {
        threadId: fixture.threadId,
        kind: "stop",
      });
      if (!queuedStop?.commandId) {
        throw new Error("Expected a queued stop operation");
      }

      expect(
        finalizeStoppedThread(harness.deps, {
          threadId: fixture.threadId,
        }),
      ).toBe(true);

      const finalizedThread = getThread(harness.db, fixture.threadId);
      expect(finalizedThread).toMatchObject({
        status: "idle",
        stopRequestedAt: null,
      });
      expect(getCommand(harness.db, queuedStop.commandId)?.state).toBe("error");
      expect(
        getThreadOperation(harness.db, {
          threadId: fixture.threadId,
          kind: "stop",
        }),
      ).toMatchObject({
        commandId: queuedStop.commandId,
        state: "completed",
      });

      const events = listEvents(harness.db, { threadId: fixture.threadId });
      expect(events.map((event) => event.type)).toEqual([
        "turn/started",
        "turn/completed",
        "system/thread/interrupted",
      ]);
      expect(getSingleEvent(events, "turn/completed").data).toBe(
        JSON.stringify({
          providerThreadId: fixture.providerThreadId,
          status: "interrupted",
        }),
      );
      expect(getSingleEvent(events, "system/thread/interrupted").data).toBe(
        JSON.stringify({
          reason: "manual-stop",
        }),
      );
    } finally {
      await harness.cleanup();
    }
  });
});
