import type { ThreadEvent } from "@bb/domain";
import {
  getReplayCaptureTerminalTurnId,
  type ReplayCaptureManifest,
  type ReplayRawProviderCaptureEntry,
  type ReplayRawProviderEventRecord,
} from "./index.js";
import { ReplayCaptureReadError } from "./reader.js";

export interface ReplayEventRecord {
  event: ThreadEvent;
  relativeMs: number;
}

export interface ReplayTerminalIdentifiers {
  providerThreadId: string;
  turnId: string;
}

export interface ReplayTimingState {
  previousRelativeMs: number;
  speed: number;
}

export interface ReplayTranslatedEvent {
  event: ThreadEvent;
}

export interface ReplayRawProviderEventTranslator {
  translate(
    rawProviderEvent: ReplayRawProviderCaptureEntry,
  ): Iterable<ReplayTranslatedEvent>;
}

export interface StreamRawProviderReplayEventsArgs {
  records: AsyncIterable<ReplayRawProviderEventRecord>;
  translator: ReplayRawProviderEventTranslator;
}

export interface RemapReplayThreadEventArgs {
  event: ThreadEvent;
  providerThreadId: string;
  threadId: string;
}

export interface WaitForReplayTimeArgs {
  relativeMs: number;
  signal: AbortSignal;
  timing: ReplayTimingState;
}

export class ReplayPlaybackAbortError extends Error {
  constructor() {
    super("Replay cancelled");
    this.name = "ReplayPlaybackAbortError";
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw new ReplayPlaybackAbortError();
  }
}

export async function* streamRawProviderReplayEvents(
  args: StreamRawProviderReplayEventsArgs,
): AsyncGenerator<ReplayEventRecord> {
  for await (const record of args.records) {
    const translated = args.translator.translate(record.entry);
    for (const entry of translated) {
      yield {
        event: entry.event,
        relativeMs: record.relativeMs,
      };
    }
  }
}

export function remapReplayThreadEvent(
  args: RemapReplayThreadEventArgs,
): ThreadEvent {
  if (args.event.type === "thread/name/updated") {
    const threadName = args.event.threadName.startsWith("[Replay] ")
      ? args.event.threadName
      : `[Replay] ${args.event.threadName}`;
    return {
      ...args.event,
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
      threadName,
    };
  }
  if ("providerThreadId" in args.event) {
    return {
      ...args.event,
      providerThreadId: args.providerThreadId,
      threadId: args.threadId,
    };
  }
  return { ...args.event, threadId: args.threadId };
}

export function replayTerminalIdentifiers(
  manifest: ReplayCaptureManifest,
): ReplayTerminalIdentifiers {
  return {
    providerThreadId: `replay:${manifest.captureId}`,
    turnId: getReplayCaptureTerminalTurnId(manifest),
  };
}

export async function waitForReplayTime(
  args: WaitForReplayTimeArgs,
): Promise<void> {
  throwIfAborted(args.signal);
  if (args.relativeMs < args.timing.previousRelativeMs) {
    throw new ReplayCaptureReadError(
      "invalid_replay_capture",
      "Replay event timing moved backwards",
    );
  }
  const delayMs =
    (args.relativeMs - args.timing.previousRelativeMs) / args.timing.speed;
  args.timing.previousRelativeMs = args.relativeMs;
  if (delayMs <= 0) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    function finish() {
      if (settled) {
        return;
      }
      settled = true;
      args.signal.removeEventListener("abort", handleAbort);
      resolve();
    }
    function handleAbort() {
      clearTimeout(timeout);
      finish();
    }
    const timeout = setTimeout(finish, delayMs);
    args.signal.addEventListener("abort", handleAbort, { once: true });
  });
  throwIfAborted(args.signal);
}
