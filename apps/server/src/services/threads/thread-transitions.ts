import {
  InvalidThreadStatusTransitionError,
  transitionThreadStatus,
  transitionThreadStatusInTransaction,
} from "@bb/db";
import type { DbConnection, DbNotifier, DbTransaction } from "@bb/db";
import type { ThreadStatus } from "@bb/domain";
import type { NotificationHub } from "../../ws/hub.js";

export function tryTransition(
  db: DbConnection,
  hub: NotificationHub,
  threadId: string,
  targetStatus: ThreadStatus,
): boolean {
  try {
    transitionThreadStatus(db, hub, threadId, targetStatus);
    return true;
  } catch (error) {
    if (error instanceof InvalidThreadStatusTransitionError) {
      return false;
    }
    throw error;
  }
}

export function tryTransitionInTransaction(
  db: DbTransaction,
  hub: DbNotifier,
  threadId: string,
  targetStatus: ThreadStatus,
): boolean {
  try {
    transitionThreadStatusInTransaction(db, {
      id: threadId,
      newStatus: targetStatus,
    });
    hub.notifyThread(threadId, ["status-changed"]);
    return true;
  } catch (error) {
    if (error instanceof InvalidThreadStatusTransitionError) {
      return false;
    }
    throw error;
  }
}
