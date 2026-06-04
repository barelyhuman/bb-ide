import { describe, expect, it } from "vitest";
import {
  createPendingClientTurnRequestInTransaction,
  getClientTurnRequest,
  getCommand,
  getThread,
  getThreadOperation,
  listEvents,
} from "@bb/db";
import { encodeClientTurnRequestIdNumber } from "@bb/domain";
import type { ClientTurnRequestId, ThreadEventType } from "@bb/domain";
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
import { withTestHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

type ListedEvent = ReturnType<typeof listEvents>[number];

interface ActiveThreadWithTurnFixture {
  environmentId: string;
  hostId: string;
  providerThreadId: string;
  threadId: string;
  turnId: string;
}

interface SeedPendingClientTurnRequestArgs {
  commandId: string;
  environmentId: string | null;
  requestEventSequence: number;
  requestId: ClientTurnRequestId;
  threadId: string;
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

function seedPendingClientTurnRequest(
  harness: TestAppHarness,
  args: SeedPendingClientTurnRequestArgs,
): void {
  harness.db.transaction((tx) => {
    createPendingClientTurnRequestInTransaction(tx, {
      commandId: args.commandId,
      commandType: "turn.submit",
      environmentId: args.environmentId,
      requestEventSequence: args.requestEventSequence,
      requestId: args.requestId,
      threadId: args.threadId,
    });
  });
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
    await withTestHarness(async (harness) => {
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
    });
  });

  it("does not mutate an active thread when no active turn exists", async () => {
    await withTestHarness(async (harness) => {
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
    });
  });

  it("finalizes a manually stopped active thread without an active turn and cancels pending requests", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-thread-lifecycle-manual-no-turn",
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
      const requestId = encodeClientTurnRequestIdNumber({ value: 10 });
      seedPendingClientTurnRequest(harness, {
        commandId: "hcmd_thread_lifecycle_manual_pending",
        environmentId: environment.id,
        requestEventSequence: 10,
        requestId,
        threadId: thread.id,
      });
      requestThreadStop(harness.deps, {
        environmentId: environment.id,
        hostId: host.id,
        interruptionReason: "manual-stop",
        stopRequestedAt: null,
        threadId: thread.id,
      });

      expect(
        finalizeStoppedThread(harness.deps, {
          threadId: thread.id,
        }),
      ).toBe(true);

      expect(getThread(harness.db, thread.id)?.status).toBe("idle");
      expect(getClientTurnRequest(harness.db, { requestId })).toMatchObject({
        message: "Thread stopped before provider accepted the request",
        reasonCode: "runtime_canceled",
        status: "canceled",
      });
      expect(
        listEvents(harness.db, { threadId: thread.id }).map(
          (event) => event.type,
        ),
      ).toEqual(["system/thread/interrupted"]);
    });
  });

  it("finalizes a stopped active thread with one interrupted turn and thread event", async () => {
    await withTestHarness(async (harness) => {
      const fixture = seedActiveThreadWithTurn(harness);
      requestThreadStop(harness.deps, {
        environmentId: fixture.environmentId,
        hostId: fixture.hostId,
        interruptionReason: "manual-stop",
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
    });
  });
});
