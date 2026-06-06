import type { ThreadEvent } from "@bb/domain";
import type {
  HostDaemonEventBatchResponse,
  HostDaemonEventEnvelope,
  HostDaemonRejectedEvent,
} from "@bb/host-daemon-contract";
import { normalizeCaughtError, runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";

const DEFAULT_DEBOUNCE_MS = 100;

// Tripwires for noticing that delivery has stalled and the in-memory queue is
// growing. These only emit a debug log — they never drop, fault, or bound the
// queue. If they fire in practice, that is the signal to add real backpressure.
const QUEUE_DEPTH_DEBUG_THRESHOLD = 512;
const QUEUE_AGE_DEBUG_THRESHOLD_MS = 30_000;

export interface EventSinkInput {
  event: ThreadEvent;
  threadId: string;
}

export interface EventPostResult {
  acceptedEvents: HostDaemonEventBatchResponse["acceptedEvents"];
  rejectedEvents: HostDaemonEventBatchResponse["rejectedEvents"];
  kind: "accepted";
}

export interface CreateEventSinkOptions {
  isSessionOpen: () => boolean;
  logger: Pick<HostDaemonLogger, "debug" | "error" | "warn">;
  postEvents: (events: HostDaemonEventEnvelope[]) => Promise<EventPostResult>;
}

export interface EventSink {
  emit(event: EventSinkInput): void;
  flush(): Promise<void>;
  flushRequired(): Promise<void>;
  dispose(): Promise<void>;
}

interface RejectedEventSummary {
  eventIndex: number;
  reason: HostDaemonRejectedEvent["reason"];
  threadId: string;
}

export class EventSinkDisposedError extends Error {
  constructor() {
    super("Cannot emit to disposed event sink");
    this.name = "EventSinkDisposedError";
  }
}

function isWaitingForApprovalItemEvent(event: ThreadEvent): boolean {
  if (event.type !== "item/started" && event.type !== "item/completed") {
    return false;
  }

  if (
    event.item.type !== "commandExecution" &&
    event.item.type !== "fileChange"
  ) {
    return false;
  }

  return event.item.approvalStatus === "waiting_for_approval";
}

export function shouldFlushThreadEventImmediately(event: ThreadEvent): boolean {
  if (event.type === "turn/started" || event.type === "item/completed") {
    return true;
  }

  if (
    event.type === "turn/completed" ||
    event.type === "system/error" ||
    event.type === "system/thread/interrupted"
  ) {
    return true;
  }

  if (event.type === "provider/error") {
    return event.willRetry !== true;
  }

  return isWaitingForApprovalItemEvent(event);
}

function summarizeRejectedEvents(
  events: readonly HostDaemonRejectedEvent[],
): RejectedEventSummary[] {
  return events.map((event) => ({
    eventIndex: event.eventIndex,
    reason: event.reason,
    threadId: event.threadId,
  }));
}

export function createEventSink(options: CreateEventSinkOptions): EventSink {
  const queue: HostDaemonEventEnvelope[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let disposed = false;
  // When the queue first became non-empty in the current backed-up episode, or
  // null while the queue is empty. Used only for the debug tripwire below.
  let backedUpSinceMs: number | null = null;
  let backpressureLogged = false;

  function maybeLogQueuePressure(): void {
    if (backpressureLogged || backedUpSinceMs === null) {
      return;
    }
    const queueDepth = queue.length;
    const queueAgeMs = Date.now() - backedUpSinceMs;
    if (
      queueDepth < QUEUE_DEPTH_DEBUG_THRESHOLD &&
      queueAgeMs < QUEUE_AGE_DEBUG_THRESHOLD_MS
    ) {
      return;
    }
    backpressureLogged = true;
    options.logger.debug(
      { queueDepth, queueAgeMs },
      "Daemon event queue is backing up; delivery may be stalled",
    );
  }

  function clearScheduledFlush(): void {
    if (flushTimer === null) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function scheduleFlush(delayMs: number): void {
    if (disposed || flushPromise !== null) {
      return;
    }
    if (flushTimer !== null) {
      if (delayMs > 0) {
        return;
      }
      clearScheduledFlush();
    }
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush().catch((error) => {
        options.logger.error(
          runtimeErrorLogFields(normalizeCaughtError(error)),
          "Daemon event delivery failed",
        );
      });
    }, delayMs);
  }

  // Posts queued events while the session is open. Events that cannot be
  // delivered right now — because the session is closed or the post failed —
  // stay queued and are retried by the next flush (the next emit, or the
  // reconnect that reopens the session). The queue lives only in memory, so a
  // daemon crash drops anything still pending; that is an accepted tradeoff.
  async function drainQueue(): Promise<void> {
    while (queue.length > 0 && !disposed && options.isSessionOpen()) {
      const batch = queue.slice();
      let response: EventPostResult;
      try {
        response = await options.postEvents(batch);
      } catch (error) {
        options.logger.error(
          runtimeErrorLogFields(normalizeCaughtError(error)),
          "Failed to post daemon events; will retry on the next flush",
        );
        return;
      }

      if (response.rejectedEvents.length > 0) {
        options.logger.warn(
          {
            rejectedEvents: summarizeRejectedEvents(response.rejectedEvents),
          },
          "Server rejected daemon events",
        );
      }
      queue.splice(0, batch.length);
      if (queue.length === 0) {
        backedUpSinceMs = null;
        backpressureLogged = false;
      }
    }
  }

  async function flush(): Promise<void> {
    clearScheduledFlush();
    if (flushPromise !== null) {
      await flushPromise;
      return;
    }

    flushPromise = drainQueue();
    try {
      await flushPromise;
    } finally {
      flushPromise = null;
    }
  }

  return {
    emit(input): void {
      if (disposed) {
        throw new EventSinkDisposedError();
      }
      if (backedUpSinceMs === null) {
        backedUpSinceMs = Date.now();
      }
      queue.push({
        threadId: input.threadId,
        event: input.event,
      });
      maybeLogQueuePressure();
      scheduleFlush(
        shouldFlushThreadEventImmediately(input.event) ? 0 : DEFAULT_DEBOUNCE_MS,
      );
    },
    flush,
    flushRequired: flush,
    async dispose(): Promise<void> {
      disposed = true;
      clearScheduledFlush();
      if (flushPromise !== null) {
        await flushPromise.catch(() => undefined);
      }
      queue.length = 0;
    },
  };
}
