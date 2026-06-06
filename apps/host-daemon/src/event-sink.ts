import type { ThreadEvent } from "@bb/domain";
import type {
  HostDaemonEventBatchResponse,
  HostDaemonEventEnvelope,
  HostDaemonRejectedEvent,
} from "@bb/host-daemon-contract";
import { normalizeCaughtError, runtimeErrorLogFields } from "./error-utils.js";
import type { HostDaemonLogger } from "./logger.js";

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_MAX_QUEUED_EVENTS = 256;
const DEFAULT_MAX_QUEUE_AGE_MS = 30_000;
const DEFAULT_RECONNECT_RETRY_DELAY_MS = 250;

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
  logger: Pick<HostDaemonLogger, "error" | "warn">;
  postEvents: (events: HostDaemonEventEnvelope[]) => Promise<EventPostResult>;
  maxQueueAgeMs?: number;
  reconnectRetryDelayMs?: number;
}

export interface EventSink {
  emit(event: EventSinkInput): void;
  flush(): Promise<void>;
  flushRequired(): Promise<void>;
  dispose(): Promise<void>;
}

interface QueuedEvent {
  envelope: HostDaemonEventEnvelope;
  queuedAtMs: number;
}

interface RejectedEventSummary {
  eventIndex: number;
  reason: HostDaemonRejectedEvent["reason"];
  threadId: string;
}

export class EventSinkDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventSinkDeliveryError";
  }
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createEventSink(options: CreateEventSinkOptions): EventSink {
  const maxQueueAgeMs = options.maxQueueAgeMs ?? DEFAULT_MAX_QUEUE_AGE_MS;
  const reconnectRetryDelayMs =
    options.reconnectRetryDelayMs ?? DEFAULT_RECONNECT_RETRY_DELAY_MS;
  const queue: QueuedEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let flushPromise: Promise<void> | null = null;
  let disposed = false;
  let deliveryFailure: EventSinkDeliveryError | null = null;

  function clearScheduledFlush(): void {
    if (flushTimer === null) {
      return;
    }
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function fail(message: string): EventSinkDeliveryError {
    const error = new EventSinkDeliveryError(message);
    deliveryFailure = error;
    queue.length = 0;
    clearScheduledFlush();
    return error;
  }

  function assertUsable(): void {
    if (disposed) {
      throw new EventSinkDisposedError();
    }
    if (deliveryFailure !== null) {
      throw deliveryFailure;
    }
  }

  function scheduleFlush(delayMs: number): void {
    if (disposed || deliveryFailure !== null || flushPromise !== null) {
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

  function assertAcceptedBatch(
    response: EventPostResult,
    batch: readonly HostDaemonEventEnvelope[],
  ): void {
    if (response.rejectedEvents.length > 0) {
      throw fail("Daemon event batch was rejected by the server");
    }

    const acceptedEventIndexes = new Set<number>();
    for (const acceptedEvent of response.acceptedEvents) {
      const expectedEvent = batch[acceptedEvent.eventIndex];
      if (!expectedEvent) {
        throw fail("Server acknowledged an event index outside the batch");
      }
      if (acceptedEventIndexes.has(acceptedEvent.eventIndex)) {
        throw fail("Server acknowledged a daemon event more than once");
      }
      if (expectedEvent.threadId !== acceptedEvent.threadId) {
        throw fail("Server acknowledged a daemon event for the wrong thread");
      }
      acceptedEventIndexes.add(acceptedEvent.eventIndex);
    }

    if (acceptedEventIndexes.size !== batch.length) {
      throw fail("Server did not acknowledge every daemon event in the batch");
    }
  }

  async function waitForSessionAvailability(): Promise<void> {
    const oldestEvent = queue[0];
    if (!oldestEvent) {
      return;
    }
    const queuedAgeMs = Date.now() - oldestEvent.queuedAtMs;
    if (queuedAgeMs >= maxQueueAgeMs) {
      throw fail(
        `Daemon event delivery exceeded the ${maxQueueAgeMs}ms live reconnect window`,
      );
    }
    await delay(Math.min(reconnectRetryDelayMs, maxQueueAgeMs - queuedAgeMs));
  }

  async function drainQueue(): Promise<void> {
    while (queue.length > 0) {
      assertUsable();
      if (!options.isSessionOpen()) {
        await waitForSessionAvailability();
        continue;
      }

      const batch = queue.map((entry) => entry.envelope);
      let response: EventPostResult;
      try {
        response = await options.postEvents(batch);
      } catch (error) {
        const caughtError = normalizeCaughtError(error);
        options.logger.error(
          runtimeErrorLogFields(caughtError),
          "Failed to post daemon events to the server",
        );
        throw fail(caughtError.message);
      }

      if (response.rejectedEvents.length > 0) {
        options.logger.warn(
          {
            rejectedEvents: summarizeRejectedEvents(response.rejectedEvents),
          },
          "Server rejected daemon events",
        );
      }
      assertAcceptedBatch(response, batch);
      queue.splice(0, batch.length);
    }
  }

  async function flush(): Promise<void> {
    assertUsable();
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
      assertUsable();
      if (queue.length >= DEFAULT_MAX_QUEUED_EVENTS) {
        throw fail(
          `Daemon event delivery queue exceeded ${DEFAULT_MAX_QUEUED_EVENTS}`,
        );
      }
      queue.push({
        envelope: {
          threadId: input.threadId,
          event: input.event,
        },
        queuedAtMs: Date.now(),
      });
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
