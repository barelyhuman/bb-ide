export interface BufferedEventInput {
  environmentId: string;
  threadId: string;
  event: unknown;
  id?: string;
  createdAt?: number;
}

export interface BufferedEvent extends BufferedEventInput {
  id: string;
  sequence: number;
  createdAt: number;
}

type TimeoutHandle = ReturnType<typeof setTimeout>;

export interface CreateEventBufferOptions {
  postEvents: (events: BufferedEvent[]) => Promise<Record<string, number> | void>;
  initialHighWaterMarks?: Record<string, number>;
  debounceMs?: number;
  flushAtCount?: number;
  maxBufferedEvents?: number;
  now?: () => number;
  createId?: (event: Omit<BufferedEvent, "id">) => string;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
}

export interface EventBuffer {
  push(event: BufferedEventInput): BufferedEvent;
  ack(threadHighWaterMarks: Record<string, number>): void;
  flush(): Promise<void>;
  depth(): number;
  snapshot(): BufferedEvent[];
  dispose(): void;
}

const DEFAULT_DEBOUNCE_MS = 100;
const DEFAULT_FLUSH_AT_COUNT = 50;
const DEFAULT_MAX_BUFFERED_EVENTS = 1000;

export function createEventBuffer(
  options: CreateEventBufferOptions,
): EventBuffer {
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const flushAtCount = options.flushAtCount ?? DEFAULT_FLUSH_AT_COUNT;
  const maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
  const now = options.now ?? Date.now;
  const createId =
    options.createId ??
    ((event: Omit<BufferedEvent, "id">) =>
      `${event.threadId}:${event.sequence}:${event.createdAt}`);
  const setTimeoutFn = options.setTimeoutFn ?? setTimeout;
  const clearTimeoutFn = options.clearTimeoutFn ?? clearTimeout;

  const nextSequenceByThread = new Map<string, number>();
  for (const [threadId, highWaterMark] of Object.entries(
    options.initialHighWaterMarks ?? {},
  )) {
    nextSequenceByThread.set(threadId, highWaterMark + 1);
  }

  let buffer: BufferedEvent[] = [];
  let flushTimer: TimeoutHandle | null = null;
  let flushPromise: Promise<void> | null = null;

  function scheduleFlush(delayMs: number): void {
    if (flushTimer) {
      clearTimeoutFn(flushTimer);
    }

    flushTimer = setTimeoutFn(() => {
      flushTimer = null;
      void flush();
    }, delayMs);
  }

  function nextSequence(threadId: string): number {
    const nextValue = nextSequenceByThread.get(threadId) ?? 1;
    nextSequenceByThread.set(threadId, nextValue + 1);
    return nextValue;
  }

  function trimOverflow(): void {
    const overflow = buffer.length - maxBufferedEvents;
    if (overflow > 0) {
      buffer = buffer.slice(overflow);
    }
  }

  function push(event: BufferedEventInput): BufferedEvent {
    const sequence = nextSequence(event.threadId);
    const bufferedEvent: BufferedEvent = {
      ...event,
      sequence,
      createdAt: event.createdAt ?? now(),
      id: event.id ?? "",
    };
    bufferedEvent.id ||= createId(bufferedEvent);

    buffer = [...buffer, bufferedEvent];
    trimOverflow();

    if (buffer.length >= flushAtCount) {
      scheduleFlush(0);
    } else {
      scheduleFlush(debounceMs);
    }

    return bufferedEvent;
  }

  function ack(threadHighWaterMarks: Record<string, number>): void {
    if (Object.keys(threadHighWaterMarks).length === 0) {
      return;
    }

    buffer = buffer.filter((event) => {
      const highWaterMark = threadHighWaterMarks[event.threadId];
      return highWaterMark === undefined || event.sequence > highWaterMark;
    });
  }

  async function flush(): Promise<void> {
    if (flushPromise) {
      return flushPromise;
    }

    if (flushTimer) {
      clearTimeoutFn(flushTimer);
      flushTimer = null;
    }

    if (buffer.length === 0) {
      return;
    }

    const batch = buffer.slice();
    flushPromise = (async () => {
      try {
        const threadHighWaterMarks = await options.postEvents(batch);
        if (threadHighWaterMarks) {
          ack(threadHighWaterMarks);
        }
      } catch {
        scheduleFlush(debounceMs);
      } finally {
        flushPromise = null;
        if (buffer.length > 0 && !flushTimer) {
          scheduleFlush(buffer.length >= flushAtCount ? 0 : debounceMs);
        }
      }
    })();

    return flushPromise;
  }

  function dispose(): void {
    if (flushTimer) {
      clearTimeoutFn(flushTimer);
      flushTimer = null;
    }
  }

  return {
    push,
    ack,
    flush,
    depth(): number {
      return buffer.length;
    },
    snapshot(): BufferedEvent[] {
      return buffer.slice();
    },
    dispose,
  };
}
