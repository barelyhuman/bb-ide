import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { hostDaemonCursors } from "../schema.js";

/**
 * Get the server-side cursor for a host.
 * Returns 0 if no cursor exists.
 */
export function getCursor(
  db: DbConnection,
  _notifier: DbNotifier,
  hostId: string,
): number {
  const row = db
    .select()
    .from(hostDaemonCursors)
    .where(eq(hostDaemonCursors.hostId, hostId))
    .get();
  return row?.cursor ?? 0;
}

/**
 * Set the server-side cursor for a host.
 * Uses upsert semantics (insert or update on conflict).
 */
export function setCursor(
  db: DbConnection,
  _notifier: DbNotifier,
  hostId: string,
  cursor: number,
): void {
  const now = Date.now();
  const existing = db
    .select()
    .from(hostDaemonCursors)
    .where(eq(hostDaemonCursors.hostId, hostId))
    .get();

  if (existing) {
    db.update(hostDaemonCursors)
      .set({ cursor, updatedAt: now })
      .where(eq(hostDaemonCursors.hostId, hostId))
      .run();
  } else {
    db.insert(hostDaemonCursors)
      .values({ hostId, cursor, updatedAt: now })
      .run();
  }
}
