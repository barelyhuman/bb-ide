import { eq } from "drizzle-orm";
import {
  closeSession,
  getActiveSession,
  hostDaemonSessions,
  listHostThreadIds,
  type HostDaemonSessionRow,
  type SweepExpiredLeasesResult,
} from "@bb/db";
import type { HostDaemonActiveThread } from "@bb/host-daemon-contract";
import { DAEMON_DISCONNECT_GRACE_MS } from "../constants.js";
import type {
  AppDeps,
  LoggedPendingInteractionWorkSessionDeps,
} from "../types.js";
import { reconcileSessionThreads } from "./reconciliation.js";

const DAEMON_DISCONNECT_PENDING_INTERACTION_REASON =
  "Host daemon disconnected while awaiting user interaction; retry the thread to continue";
const DAEMON_EXPIRED_PENDING_INTERACTION_REASON =
  "Host daemon connection expired while awaiting user interaction; retry the thread to continue";
const DAEMON_RESTARTED_PENDING_INTERACTION_REASON =
  "Host daemon restarted while awaiting user interaction; retry the thread to continue";
const DAEMON_REPLACED_PENDING_INTERACTION_REASON =
  "Host daemon session was replaced while awaiting user interaction; retry the thread to continue";

type HostSessionOpenedDeps = LoggedPendingInteractionWorkSessionDeps;
type DaemonSocketClosedDeps = Pick<
  AppDeps,
  "db" | "hub" | "logger" | "pendingInteractions" | "terminalSessions"
>;
type ExpiredHostSessionLeaseDeps = Pick<
  AppDeps,
  "db" | "hub" | "pendingInteractions"
>;

export interface HandleHostSessionOpenedArgs {
  activeThreads: HostDaemonActiveThread[];
  hostId: string;
  openedSession: HostDaemonSessionRow;
  previousSession: HostDaemonSessionRow | null;
}

interface InterruptPendingInteractionsForSessionIdsArgs {
  reason: string;
  sessionIds: string[];
}

export interface HandleDaemonSocketClosedArgs {
  sessionId: string;
}

interface CompleteDaemonDisconnectGraceArgs {
  hostId: string;
  sessionId: string;
}

export interface HandleExpiredHostSessionLeasesArgs {
  expiredLeases: SweepExpiredLeasesResult;
}

interface ReplacedSessionPendingInteractionReasonArgs {
  openedSession: HostDaemonSessionRow;
  previousSession: HostDaemonSessionRow;
}

export async function handleHostSessionOpened(
  deps: HostSessionOpenedDeps,
  args: HandleHostSessionOpenedArgs,
): Promise<void> {
  deps.logger.info(
    {
      sessionId: args.openedSession.id,
      hostId: args.hostId,
      replacedSessionId: args.previousSession?.id ?? null,
    },
    "Session opened",
  );

  if (
    args.previousSession &&
    args.previousSession.id !== args.openedSession.id
  ) {
    deps.hub.closeDaemonSession(args.previousSession.id, "replaced");

    // Pending interactions are bound to the daemon session that registered
    // them. A new session id is a new in-memory provider-request registry,
    // even if the daemon instance id is unchanged and reports active threads.
    interruptPendingInteractionsForSessionIds(deps, {
      sessionIds: [args.previousSession.id],
      reason: getReplacedSessionPendingInteractionReason({
        openedSession: args.openedSession,
        previousSession: args.previousSession,
      }),
    });
  }

  await reconcileSessionThreads(deps, args.hostId, args.activeThreads);
}

export function handleDaemonSocketClosed(
  deps: DaemonSocketClosedDeps,
  args: HandleDaemonSocketClosedArgs,
): void {
  deps.logger.info({ sessionId: args.sessionId }, "Daemon WebSocket closed");
  deps.hub.unregisterDaemon(args.sessionId);
  deps.terminalSessions.handleDaemonSessionClosed({
    sessionId: args.sessionId,
  });

  const session = deps.db
    .select()
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.id, args.sessionId))
    .get();
  if (!session || session.status !== "active") {
    return;
  }

  // Close the session immediately so the host status reflects the disconnect
  // right away. Thread runtime status is notified immediately and again after
  // grace, but connection loss alone does not prove active turns are gone.
  closeSession(deps.db, deps.hub, args.sessionId, "daemon-disconnect");

  notifyHostThreadRuntimeStatusChanged(deps, session.hostId);
  deps.hub.scheduleDaemonDisconnect(
    args.sessionId,
    DAEMON_DISCONNECT_GRACE_MS,
    () =>
      completeDaemonDisconnectGrace(deps, {
        hostId: session.hostId,
        sessionId: args.sessionId,
      }),
  );
}

export function handleExpiredHostSessionLeases(
  deps: ExpiredHostSessionLeaseDeps,
  args: HandleExpiredHostSessionLeasesArgs,
): void {
  if (args.expiredLeases.expiredSessionIds.length === 0) {
    return;
  }

  for (const sessionId of args.expiredLeases.expiredSessionIds) {
    deps.hub.closeDaemonSession(sessionId, "expired");
  }
  interruptPendingInteractionsForSessionIds(deps, {
    sessionIds: args.expiredLeases.expiredSessionIds,
    reason: DAEMON_EXPIRED_PENDING_INTERACTION_REASON,
  });
  for (const hostId of args.expiredLeases.expiredHostIds) {
    notifyHostThreadRuntimeStatusChanged(deps, hostId);
  }
}

function completeDaemonDisconnectGrace(
  deps: ExpiredHostSessionLeaseDeps,
  args: CompleteDaemonDisconnectGraceArgs,
): void {
  interruptPendingInteractionsForSessionIds(deps, {
    sessionIds: [args.sessionId],
    reason: DAEMON_DISCONNECT_PENDING_INTERACTION_REASON,
  });

  if (getActiveSession(deps.db, args.hostId)) {
    return;
  }

  notifyHostThreadRuntimeStatusChanged(deps, args.hostId);
}

function notifyHostThreadRuntimeStatusChanged(
  deps: Pick<AppDeps, "db" | "hub">,
  hostId: string,
): void {
  for (const threadId of listHostThreadIds(deps.db, { hostId })) {
    deps.hub.notifyThread(threadId, ["status-changed"]);
  }
}

function interruptPendingInteractionsForSessionIds(
  deps: Pick<AppDeps, "pendingInteractions">,
  args: InterruptPendingInteractionsForSessionIdsArgs,
): void {
  deps.pendingInteractions.interruptPendingInteractionsForSessionIds({
    sessionIds: args.sessionIds,
    reason: args.reason,
  });
}

function getReplacedSessionPendingInteractionReason(
  args: ReplacedSessionPendingInteractionReasonArgs,
): string {
  if (args.previousSession.instanceId !== args.openedSession.instanceId) {
    return DAEMON_RESTARTED_PENDING_INTERACTION_REASON;
  }
  return DAEMON_REPLACED_PENDING_INTERACTION_REASON;
}
