import { eq } from "drizzle-orm";
import type { HostType } from "@bb/domain";
import type { DbConnection } from "../connection.js";
import type { DbNotifier } from "../notifier.js";
import { hosts } from "../schema.js";
import { createHostId } from "../ids.js";

export interface UpsertHostInput {
  id?: string;
  name: string;
  type: HostType;
  provider?: string | null;
  externalId?: string | null;
  destroyedAt?: number | null;
}

export interface UpdateHostInput {
  destroyedAt?: number | null;
  externalId?: string | null;
  name?: string;
  provider?: string | null;
}

function notifyHostMutation(
  notifier: DbNotifier,
  previous: ReturnType<typeof getHost>,
  next: ReturnType<typeof getHost>,
): void {
  if (!previous || !next) {
    return;
  }

  const hasMetadataChange =
    previous.destroyedAt !== next.destroyedAt ||
    previous.externalId !== next.externalId ||
    previous.name !== next.name ||
    previous.provider !== next.provider ||
    previous.type !== next.type;

  if (!hasMetadataChange) {
    return;
  }

  notifier.notifySystem([
    (previous.destroyedAt === null && next.destroyedAt !== null) ||
    (previous.externalId !== null && next.externalId === null)
      ? "host-disconnected"
      : "host-connected",
  ]);
}

export function upsertHost(
  db: DbConnection,
  notifier: DbNotifier,
  input: UpsertHostInput,
) {
  const now = Date.now();
  const id = input.id ?? createHostId();
  const existing = db.select().from(hosts).where(eq(hosts.id, id)).get();

  if (existing) {
    return db.update(hosts)
      .set({
        name: input.name,
        type: input.type,
        provider:
          input.provider !== undefined ? input.provider : existing.provider,
        destroyedAt:
          input.destroyedAt !== undefined
            ? input.destroyedAt
            : existing.destroyedAt,
        externalId:
          input.externalId !== undefined
            ? input.externalId
            : existing.externalId,
        lastSeenAt: now,
        updatedAt: now,
      })
      .where(eq(hosts.id, id))
      .returning()
      .get()!;
  } else {
    const row = db.insert(hosts)
      .values({
        id,
        name: input.name,
        type: input.type,
        provider: input.provider ?? null,
        destroyedAt: input.destroyedAt ?? null,
        externalId: input.externalId ?? null,
        lastSeenAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .returning()
      .get();
    notifier.notifyHost(["host-connected"]);
    return row;
  }
}

export function getHost(db: DbConnection, id: string) {
  return db.select().from(hosts).where(eq(hosts.id, id)).get() ?? null;
}

export function listHosts(db: DbConnection) {
  return db.select().from(hosts).all();
}

export function updateHost(
  db: DbConnection,
  notifier: DbNotifier,
  hostId: string,
  input: UpdateHostInput,
) {
  const existing = getHost(db, hostId);
  if (!existing) {
    return null;
  }

  const now = Date.now();
  db.update(hosts)
    .set({
      ...(input.destroyedAt !== undefined ? { destroyedAt: input.destroyedAt } : {}),
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.externalId !== undefined ? { externalId: input.externalId } : {}),
      lastSeenAt: now,
      updatedAt: now,
    })
    .where(eq(hosts.id, hostId))
    .run();

  const updated = getHost(db, hostId);
  notifyHostMutation(notifier, existing, updated);
  return updated;
}

export function deleteHost(
  db: DbConnection,
  notifier: DbNotifier,
  hostId: string,
) {
  const existing = getHost(db, hostId);
  if (!existing) {
    return false;
  }

  db.delete(hosts).where(eq(hosts.id, hostId)).run();
  notifier.notifySystem(["host-disconnected"]);
  return true;
}
