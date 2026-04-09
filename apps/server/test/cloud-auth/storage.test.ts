import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  SandboxProviderCredentialRecord,
  UpsertSandboxProviderCredentialArgs,
} from "@bb/db";
import { afterEach, describe, expect, it } from "vitest";
import { createCloudAuthCrypto } from "../../src/services/cloud-auth/crypto.js";
import type {
  ClaudeStoredCredential,
  CodexStoredCredential,
} from "../../src/services/cloud-auth/provider-definitions.js";
import {
  buildSandboxProviderCredentialUpsert,
  deserializeCloudAuthCredential,
} from "../../src/services/cloud-auth/storage.js";

const tempDirs: string[] = [];

interface BuildCredentialRecordArgs {
  createdAt: number;
  id: string;
  upsert: UpsertSandboxProviderCredentialArgs;
}

async function makeTempDir(): Promise<string> {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "bb-cloud-auth-storage-"));
  tempDirs.push(tempDir);
  return tempDir;
}

function buildCredentialRecord(
  args: BuildCredentialRecordArgs,
): SandboxProviderCredentialRecord {
  return {
    createdAt: args.createdAt,
    encryptedAccessToken: args.upsert.encryptedAccessToken,
    encryptedIdToken: args.upsert.encryptedIdToken,
    encryptedMetadata: args.upsert.encryptedMetadata,
    encryptedRefreshToken: args.upsert.encryptedRefreshToken,
    expiresAt: args.upsert.expiresAt,
    id: args.id,
    label: args.upsert.label,
    lastErrorMessage: args.upsert.lastErrorMessage,
    lastRefreshedAt: args.upsert.lastRefreshedAt,
    providerId: args.upsert.providerId,
    updatedAt: args.upsert.updatedAt,
  };
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((tempDir) =>
      rm(tempDir, { force: true, recursive: true })
    ),
  );
});

describe("cloud auth storage", () => {
  it("round-trips claude credentials through encrypted storage columns", async () => {
    const crypto = await createCloudAuthCrypto({
      dataDir: await makeTempDir(),
    });
    const credential: ClaudeStoredCredential = {
      accessToken: "claude-access-token",
      accountEmail: "claude@example.test",
      accountId: "acct_claude",
      expiresAt: 1_900_000_000_000,
      providerId: "claude-code",
      refreshToken: "claude-refresh-token",
      scopes: ["user:profile", "user:inference"],
      subscriptionType: "max",
    };

    const upsert = buildSandboxProviderCredentialUpsert({
      credential,
      crypto,
      label: "claude@example.test",
      lastErrorMessage: null,
      lastRefreshedAt: 1_800_000_000_000,
      updatedAt: 1_800_000_000_100,
    });

    expect(upsert.encryptedAccessToken).not.toContain("claude-access-token");
    expect(upsert.encryptedRefreshToken).not.toContain("claude-refresh-token");
    expect(upsert.encryptedIdToken).toBeNull();
    expect(
      deserializeCloudAuthCredential({
        crypto,
        record: buildCredentialRecord({
          createdAt: 1_800_000_000_050,
          id: "cred_claude",
          upsert,
        }),
      }),
    ).toEqual(credential);
  });

  it("round-trips codex credentials through encrypted storage columns", async () => {
    const crypto = await createCloudAuthCrypto({
      dataDir: await makeTempDir(),
    });
    const credential: CodexStoredCredential = {
      accessToken: "codex-access-token",
      accountId: "acct_codex",
      expiresAt: 1_900_000_100_000,
      idToken: "codex-id-token",
      providerId: "codex",
      refreshToken: "codex-refresh-token",
    };

    const upsert = buildSandboxProviderCredentialUpsert({
      credential,
      crypto,
      label: "codex@example.test",
      lastErrorMessage: "refresh failed",
      lastRefreshedAt: 1_800_000_100_000,
      updatedAt: 1_800_000_100_100,
    });

    expect(upsert.encryptedAccessToken).not.toContain("codex-access-token");
    expect(upsert.encryptedRefreshToken).not.toContain("codex-refresh-token");
    expect(upsert.encryptedIdToken).not.toBeNull();
    expect(
      deserializeCloudAuthCredential({
        crypto,
        record: buildCredentialRecord({
          createdAt: 1_800_000_100_050,
          id: "cred_codex",
          upsert,
        }),
      }),
    ).toEqual(credential);
  });
});
