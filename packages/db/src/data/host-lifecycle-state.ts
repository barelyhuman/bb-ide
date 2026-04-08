import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { hosts } from "../schema.js";

export interface UpdateHostLifecycleStateInput {
  hostId: string;
  lastActivityAt?: number;
  suspendedAt?: number | null;
}

export function updateHostLifecycleState(
  db: DbConnection,
  input: UpdateHostLifecycleStateInput,
) {
  return db
    .update(hosts)
    .set({
      ...(input.lastActivityAt !== undefined
        ? { lastActivityAt: input.lastActivityAt }
        : {}),
      ...(input.suspendedAt !== undefined
        ? { suspendedAt: input.suspendedAt }
        : {}),
      updatedAt: Date.now(),
    })
    .where(eq(hosts.id, input.hostId))
    .returning()
    .get() ?? null;
}
