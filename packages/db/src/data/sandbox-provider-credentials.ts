import { eq } from "drizzle-orm";
import type { DbConnection } from "../connection.js";
import { createSandboxProviderCredentialId } from "../ids.js";
import { sandboxProviderCredentials } from "../schema.js";

export interface UpsertSandboxProviderCredentialArgs {
  providerId: string;
  encryptedPayload: string;
  label: string | null;
  expiresAt: number | null;
  lastRefreshedAt: number | null;
  lastErrorMessage: string | null;
  updatedAt?: number;
}

export interface SandboxProviderCredentialRecord {
  id: string;
  providerId: string;
  encryptedPayload: string;
  label: string | null;
  expiresAt: number | null;
  lastRefreshedAt: number | null;
  lastErrorMessage: string | null;
  createdAt: number;
  updatedAt: number;
}

function toRecord(
  row: typeof sandboxProviderCredentials.$inferSelect,
): SandboxProviderCredentialRecord {
  return {
    id: row.id,
    providerId: row.providerId,
    encryptedPayload: row.encryptedPayload,
    label: row.label,
    expiresAt: row.expiresAt ? row.expiresAt.getTime() : null,
    lastRefreshedAt: row.lastRefreshedAt ? row.lastRefreshedAt.getTime() : null,
    lastErrorMessage: row.lastErrorMessage,
    createdAt: row.createdAt.getTime(),
    updatedAt: row.updatedAt.getTime(),
  };
}

export function getSandboxProviderCredentialByProviderId(
  db: DbConnection,
  providerId: string,
): SandboxProviderCredentialRecord | null {
  const row = db
    .select()
    .from(sandboxProviderCredentials)
    .where(eq(sandboxProviderCredentials.providerId, providerId))
    .get();

  return row ? toRecord(row) : null;
}

export function listSandboxProviderCredentials(
  db: DbConnection,
): SandboxProviderCredentialRecord[] {
  return db
    .select()
    .from(sandboxProviderCredentials)
    .all()
    .map(toRecord);
}

export function upsertSandboxProviderCredential(
  db: DbConnection,
  args: UpsertSandboxProviderCredentialArgs,
): SandboxProviderCredentialRecord {
  const now = new Date(args.updatedAt ?? Date.now());
  const existing = getSandboxProviderCredentialByProviderId(db, args.providerId);
  const credentialId = existing?.id ?? createSandboxProviderCredentialId();
  const createdAt = existing ? new Date(existing.createdAt) : now;

  const row = db
    .insert(sandboxProviderCredentials)
    .values({
      id: credentialId,
      providerId: args.providerId,
      encryptedPayload: args.encryptedPayload,
      label: args.label,
      expiresAt: args.expiresAt === null ? null : new Date(args.expiresAt),
      lastRefreshedAt:
        args.lastRefreshedAt === null ? null : new Date(args.lastRefreshedAt),
      lastErrorMessage: args.lastErrorMessage,
      createdAt,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: sandboxProviderCredentials.providerId,
      set: {
        encryptedPayload: args.encryptedPayload,
        label: args.label,
        expiresAt: args.expiresAt === null ? null : new Date(args.expiresAt),
        lastRefreshedAt:
          args.lastRefreshedAt === null
            ? null
            : new Date(args.lastRefreshedAt),
        lastErrorMessage: args.lastErrorMessage,
        updatedAt: now,
      },
    })
    .returning()
    .get();

  return toRecord(row);
}

export function deleteSandboxProviderCredentialByProviderId(
  db: DbConnection,
  providerId: string,
): boolean {
  const existing = getSandboxProviderCredentialByProviderId(db, providerId);
  if (!existing) {
    return false;
  }

  db
    .delete(sandboxProviderCredentials)
    .where(eq(sandboxProviderCredentials.providerId, providerId))
    .run();
  return true;
}
