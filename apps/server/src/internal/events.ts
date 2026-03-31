import { and, eq, inArray } from "drizzle-orm";
import {
  deriveStoredEventItemFields,
  environments,
  getHighWaterMarks,
  getThread,
  insertEvents,
  threads,
  updateThread,
} from "@bb/db";
import {
  hostDaemonEventBatchRequestSchema,
  typedRoutes,
  type HostDaemonEventEnvelope,
  type HostDaemonInternalSchema,
} from "@bb/host-daemon-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import type { AppDeps } from "../types.js";
import { sendNextQueuedDraftIfPresent } from "../services/queued-drafts.js";
import { tryTransition } from "../services/thread-transitions.js";
import { applyTurnCompletedEvent } from "./turn-completed-events.js";
import { requireActiveSession } from "./session-state.js";

interface ToStoredEventArgs {
  envelope: HostDaemonEventEnvelope;
  environmentId: string;
}

interface ResolveCanonicalEventBatchEnvironmentsArgs {
  hostId: string;
  events: HostDaemonEventEnvelope[];
}

interface ResolveCanonicalEventBatchEnvironmentsResult {
  canonicalEnvironmentIds: string[];
}

function resolveProviderIdentifiers(
  event: HostDaemonEventEnvelope["event"],
): { providerThreadId: string | null; turnId: string | null } {
  switch (event.type) {
    case "thread/started":
    case "client/thread/start":
    case "client/turn/requested":
    case "client/turn/start":
    case "system/error":
    case "system/manager/user_message":
    case "system/thread/interrupted":
    case "system/thread-title/updated":
    case "system/operation":
    case "system/provisioning":
      return { providerThreadId: null, turnId: null };
    case "thread/identity":
    case "thread/name/updated":
    case "thread/compacted":
    case "warning":
      return { providerThreadId: event.providerThreadId, turnId: null };
    case "turn/started":
    case "turn/completed":
    case "item/started":
    case "item/completed":
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/fileChange/outputDelta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta":
    case "item/plan/delta":
    case "item/mcpToolCall/progress":
    case "item/toolCall/progress":
    case "thread/tokenUsage/updated":
    case "turn/plan/updated":
    case "turn/diff/updated":
      return {
        providerThreadId: event.providerThreadId,
        turnId: event.turnId,
      };
    case "error":
    case "provider/unhandled":
      return {
        providerThreadId: event.providerThreadId,
        turnId: event.turnId ?? null,
      };
    default: {
      throw new Error("Unsupported event type");
    }
  }
}

function toStoredEvent(args: ToStoredEventArgs) {
  const envelope = args.envelope;
  const { type, threadId, ...data } = envelope.event;
  return {
    threadId: envelope.threadId,
    environmentId: args.environmentId,
    ...resolveProviderIdentifiers(envelope.event),
    sequence: envelope.sequence,
    type,
    // Provider events keep the daemon timestamp even though server-originated
    // events still use server time.
    createdAt: envelope.createdAt,
    ...deriveStoredEventItemFields(envelope.event),
    data: JSON.stringify(data),
  };
}

async function applyEventEffects(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  events: HostDaemonEventEnvelope[],
): Promise<void> {
  for (const entry of events) {
    try {
      const event = entry.event;
      if (event.type === "turn/started") {
        const thread = getThread(deps.db, entry.threadId);
        if (!thread) {
          continue;
        }
        if (thread.status === "idle" || thread.status === "error") {
          tryTransition(deps.db, deps.hub, thread.id, "active");
        }
        continue;
      }

      if (event.type === "turn/completed") {
        applyTurnCompletedEvent(deps, {
          ...event,
          threadId: entry.threadId,
        });
        if (event.status === "completed") {
          await sendNextQueuedDraftIfPresent(deps, {
            threadId: entry.threadId,
          });
        }
        continue;
      }

      if (event.type === "thread/name/updated") {
        updateThread(deps.db, deps.hub, entry.threadId, {
          title: event.threadName,
        });
      }
    } catch (error) {
      deps.logger.error(
        {
          err: error,
          eventType: entry.event.type,
          sequence: entry.sequence,
          threadId: entry.threadId,
        },
        "Failed to apply event side effects",
      );
    }
  }
}

function resolveCanonicalEventBatchEnvironments(
  deps: Pick<AppDeps, "db">,
  args: ResolveCanonicalEventBatchEnvironmentsArgs,
): ResolveCanonicalEventBatchEnvironmentsResult {
  const threadIds = [...new Set(args.events.map((entry) => entry.threadId))];
  if (threadIds.length === 0) {
    return {
      canonicalEnvironmentIds: [],
    };
  }

  const ownedThreads = deps.db
    .select({
      threadId: threads.id,
      environmentId: environments.id,
    })
    .from(threads)
    .innerJoin(environments, eq(threads.environmentId, environments.id))
    .where(
      and(
        inArray(threads.id, threadIds),
        eq(environments.hostId, args.hostId),
      ),
    )
    .all();

  if (ownedThreads.length !== threadIds.length) {
    throw new ApiError(
      403,
      "invalid_request",
      "Event batch contains threads that do not belong to the session host",
    );
  }

  const canonicalEnvironmentIdByThreadId = new Map<string, string>();
  for (const ownedThread of ownedThreads) {
    canonicalEnvironmentIdByThreadId.set(
      ownedThread.threadId,
      ownedThread.environmentId,
    );
  }

  const canonicalEnvironmentIds: string[] = [];
  for (const entry of args.events) {
    const canonicalEnvironmentId = canonicalEnvironmentIdByThreadId.get(
      entry.threadId,
    );
    if (!canonicalEnvironmentId) {
      throw new Error("Validated thread is missing a canonical environment");
    }
    if (entry.environmentId !== canonicalEnvironmentId) {
      throw new ApiError(
        400,
        "invalid_request",
        "Event batch contains environmentIds that do not match the thread environment",
      );
    }
    canonicalEnvironmentIds.push(canonicalEnvironmentId);
  }

  return {
    canonicalEnvironmentIds,
  };
}

export function registerInternalEventRoutes(app: Hono, deps: AppDeps): void {
  const { post } = typedRoutes<HostDaemonInternalSchema>(app, {
    onValidationError: (msg) => new ApiError(400, "invalid_request", msg),
  });

  post("/session/events", hostDaemonEventBatchRequestSchema, async (context, payload) => {
    const session = requireActiveSession(deps.db, payload.sessionId);
    const { canonicalEnvironmentIds } = resolveCanonicalEventBatchEnvironments(deps, {
      hostId: session.hostId,
      events: payload.events,
    });

    const insertResult = insertEvents(
      deps.db,
      deps.hub,
      payload.events.map((entry, index) => {
        const environmentId = canonicalEnvironmentIds[index];
        if (!environmentId) {
          throw new Error("Missing canonical environment for validated event");
        }
        return toStoredEvent({
          envelope: entry,
          environmentId,
        });
      }),
    );

    const insertedEventIndexLookup = new Set(insertResult.insertedInputIndexes);
    await applyEventEffects(
      deps,
      payload.events.filter(
        (entry, index) =>
          entry.event.type !== "turn/completed" ||
          insertedEventIndexLookup.has(index),
      ),
    );

    return context.json({
      threadHighWaterMarks: getHighWaterMarks(
        deps.db,
        payload.events.map((event) => event.threadId),
      ),
    });
  });
}
