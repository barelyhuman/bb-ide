import { eq } from "drizzle-orm";
import { events } from "@bb/db";
import { threadScope } from "@bb/domain";
import {
  hostDaemonEventBatchResponseSchema,
  type HostDaemonEventEnvelope,
} from "@bb/host-daemon-contract";
import { describe, expect, it, vi } from "vitest";
import { internalAuthHeaders } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedEvent,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";
import type { TestAppHarness } from "../helpers/test-app.js";

interface SeedEventRouteArgs {
  hostType?: "persistent" | "ephemeral";
}

interface PostEventBatchArgs {
  harness: TestAppHarness;
  sessionId: string;
  events: HostDaemonEventEnvelope[];
}

async function postEventBatch(args: PostEventBatchArgs): Promise<Response> {
  return args.harness.app.request("/internal/session/events", {
    method: "POST",
    headers: internalAuthHeaders(args.harness),
    body: JSON.stringify({
      sessionId: args.sessionId,
      events: args.events,
    }),
  });
}

function setupEventRoute(args: SeedEventRouteArgs = {}) {
  return createTestAppHarness().then((harness) => {
    const { host, session } = seedHostSession(harness.deps, {
      type: args.hostType,
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
    return {
      environment,
      harness,
      host,
      project,
      session,
      thread,
    };
  });
}

describe("internal event append ownership", () => {
  it("assigns server-owned sequences and returns accepted producer events", async () => {
    const { environment, harness, session, thread } = await setupEventRoute();
    try {
      seedEvent(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        sequence: 3,
        type: "system/error",
        scope: threadScope(),
        data: { message: "existing" },
      });

      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "first daemon",
            },
          },
          {
            producerEventId: "hdevt_23456789abcdefghijkn",
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "second daemon",
            },
          },
        ],
      });

      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        acceptedEvents: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            sequence: 4,
          },
          {
            producerEventId: "hdevt_23456789abcdefghijkn",
            threadId: thread.id,
            sequence: 5,
          },
        ],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toMatchObject([
        { sequence: 3, producerEventId: null },
        {
          sequence: 4,
          producerEventId: "hdevt_23456789abcdefghijkm",
          producerEventPayloadHash: expect.any(String),
        },
        {
          sequence: 5,
          producerEventId: "hdevt_23456789abcdefghijkn",
          producerEventPayloadHash: expect.any(String),
        },
      ]);
    } finally {
      await harness.cleanup();
    }
  });

  it("assigns distinct sequences for simultaneous requests on the same thread", async () => {
    const { harness, session, thread } = await setupEventRoute();
    try {
      const [firstResponse, secondResponse] = await Promise.all([
        postEventBatch({
          harness,
          sessionId: session.id,
          events: [
            {
              producerEventId: "hdevt_23456789abcdefghijkp",
              threadId: thread.id,
              event: {
                type: "system/error",
                threadId: thread.id,
                scope: threadScope(),
                message: "first simultaneous daemon",
              },
            },
          ],
        }),
        postEventBatch({
          harness,
          sessionId: session.id,
          events: [
            {
              producerEventId: "hdevt_23456789abcdefghijkq",
              threadId: thread.id,
              event: {
                type: "system/error",
                threadId: thread.id,
                scope: threadScope(),
                message: "second simultaneous daemon",
              },
            },
          ],
        }),
      ]);

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);
      const firstBody = hostDaemonEventBatchResponseSchema.parse(
        await readJson(firstResponse),
      );
      const secondBody = hostDaemonEventBatchResponseSchema.parse(
        await readJson(secondResponse),
      );
      expect(
        [...firstBody.acceptedEvents, ...secondBody.acceptedEvents]
          .map((event) => event.sequence)
          .sort((left, right) => left - right),
      ).toEqual([1, 2]);

      const storedRows = harness.db
        .select({
          producerEventId: events.producerEventId,
          sequence: events.sequence,
        })
        .from(events)
        .where(eq(events.threadId, thread.id))
        .all();

      expect(storedRows).toHaveLength(2);
      expect(
        storedRows
          .map((row) => row.sequence)
          .sort((left, right) => left - right),
      ).toEqual([1, 2]);
      expect(
        storedRows
          .map((row) => row.producerEventId)
          .sort((left, right) => String(left).localeCompare(String(right))),
      ).toEqual(["hdevt_23456789abcdefghijkp", "hdevt_23456789abcdefghijkq"]);
    } finally {
      await harness.cleanup();
    }
  });

  it("returns existing sequences for identical producer retries and appends new events in order", async () => {
    const { harness, session, thread } = await setupEventRoute();
    try {
      const firstEvent: HostDaemonEventEnvelope = {
        producerEventId: "hdevt_23456789abcdefghijkm",
        threadId: thread.id,
        event: {
          type: "system/error",
          threadId: thread.id,
          scope: threadScope(),
          message: "first daemon",
        },
      };
      const firstResponse = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [firstEvent],
      });
      expect(firstResponse.status).toBe(200);

      const retryResponse = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          firstEvent,
          {
            producerEventId: "hdevt_23456789abcdefghijkn",
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "second daemon",
            },
          },
        ],
      });

      expect(retryResponse.status).toBe(200);
      await expect(readJson(retryResponse)).resolves.toEqual({
        acceptedEvents: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            sequence: 1,
          },
          {
            producerEventId: "hdevt_23456789abcdefghijkn",
            threadId: thread.id,
            sequence: 2,
          },
        ],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(2);
    } finally {
      await harness.cleanup();
    }
  });

  it("treats semantically identical canonical payloads as the same retry", async () => {
    const { harness, session, thread } = await setupEventRoute();
    try {
      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            event: {
              type: "provider/unhandled",
              threadId: thread.id,
              providerThreadId: "provider-thread",
              providerId: "codex",
              rawType: "raw",
              rawEvent: {
                jsonrpc: "2.0",
                method: "test",
                params: { z: true, a: "value" },
              },
              scope: threadScope(),
            },
          },
        ],
      });
      expect(response.status).toBe(200);

      const retryResponse = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            event: {
              type: "provider/unhandled",
              threadId: thread.id,
              providerThreadId: "provider-thread",
              providerId: "codex",
              rawType: "raw",
              rawEvent: {
                jsonrpc: "2.0",
                method: "test",
                params: { a: "value", z: true },
              },
              scope: threadScope(),
            },
          },
        ],
      });

      expect(retryResponse.status).toBe(200);
      await expect(readJson(retryResponse)).resolves.toEqual({
        acceptedEvents: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            sequence: 1,
          },
        ],
      });
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(1);
    } finally {
      await harness.cleanup();
    }
  });

  it("rejects producerEventId retries with mismatched payloads", async () => {
    const { harness, session, thread } = await setupEventRoute();
    const loggerError = vi.fn();
    const originalLoggerError = harness.deps.logger.error;
    harness.deps.logger.error = loggerError;
    try {
      const response = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "first daemon",
            },
          },
        ],
      });
      expect(response.status).toBe(200);

      const mismatchResponse = await postEventBatch({
        harness,
        sessionId: session.id,
        events: [
          {
            producerEventId: "hdevt_23456789abcdefghijkm",
            threadId: thread.id,
            event: {
              type: "system/error",
              threadId: thread.id,
              scope: threadScope(),
              message: "different daemon payload",
            },
          },
        ],
      });

      expect(mismatchResponse.status).toBe(409);
      await expect(readJson(mismatchResponse)).resolves.toEqual({
        code: "producer_event_payload_mismatch",
        message: "Producer event id was reused with a different payload",
      });
      expect(loggerError).toHaveBeenCalledWith(
        expect.objectContaining({
          producerEventId: "hdevt_23456789abcdefghijkm",
          sessionId: session.id,
        }),
        "Producer event id payload mismatch",
      );
      expect(
        harness.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all(),
      ).toHaveLength(1);
    } finally {
      harness.deps.logger.error = originalLoggerError;
      await harness.cleanup();
    }
  });
});
