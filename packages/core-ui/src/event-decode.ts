import type { ThreadEvent, ThreadEventRow } from "@bb/domain";

/** Extract the optional turnId from any decoded ThreadEvent. */
export function getEventTurnId(decoded: ThreadEvent): string | undefined {
  return "turnId" in decoded ? (decoded as { turnId?: string }).turnId : undefined;
}

/** Row metadata that travels alongside the decoded event. */
export interface EventMeta {
  id: string;
  seq: number;
  createdAt: number;
}

export function decodeRow(row: ThreadEventRow): { event: ThreadEvent; meta: EventMeta } {
  const data = row.data as Record<string, unknown>;
  return {
    event: { type: row.type, threadId: row.threadId, ...data } as ThreadEvent,
    meta: { id: row.id, seq: row.seq, createdAt: row.createdAt },
  };
}
