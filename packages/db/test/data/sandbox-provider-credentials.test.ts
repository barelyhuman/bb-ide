import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import {
  deleteSandboxProviderCredentialByProviderId,
  getSandboxProviderCredentialByProviderId,
  listSandboxProviderCredentials,
  upsertSandboxProviderCredential,
} from "../../src/data/sandbox-provider-credentials.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  return { db };
}

describe("sandbox provider credentials", () => {
  it("upserts a single credential per provider", () => {
    const { db } = setup();

    const first = upsertSandboxProviderCredential(db, {
      providerId: "codex",
      encryptedAccessToken: "access-1",
      encryptedRefreshToken: "refresh-1",
      encryptedIdToken: "id-1",
      encryptedMetadata: "metadata-1",
      label: "first",
      expiresAt: 1_700_000_000_000,
      lastRefreshedAt: 1_700_000_000_100,
      lastErrorMessage: null,
      updatedAt: 1_700_000_000_200,
    });
    const second = upsertSandboxProviderCredential(db, {
      providerId: "codex",
      encryptedAccessToken: "access-2",
      encryptedRefreshToken: "refresh-2",
      encryptedIdToken: null,
      encryptedMetadata: "metadata-2",
      label: "second",
      expiresAt: 1_700_000_100_000,
      lastRefreshedAt: 1_700_000_100_100,
      lastErrorMessage: "refresh failed",
      updatedAt: 1_700_000_100_200,
    });

    expect(second.id).toBe(first.id);
    expect(second.encryptedAccessToken).toBe("access-2");
    expect(second.encryptedRefreshToken).toBe("refresh-2");
    expect(second.encryptedIdToken).toBeNull();
    expect(second.encryptedMetadata).toBe("metadata-2");
    expect(second.label).toBe("second");
    expect(second.lastErrorMessage).toBe("refresh failed");
    expect(second.createdAt).toBe(first.createdAt);
    expect(second.updatedAt).toBe(1_700_000_100_200);
    expect(listSandboxProviderCredentials(db)).toHaveLength(1);
  });

  it("loads and deletes credentials by provider", () => {
    const { db } = setup();

    upsertSandboxProviderCredential(db, {
      providerId: "claude-code",
      encryptedAccessToken: "access-claude",
      encryptedRefreshToken: "refresh-claude",
      encryptedIdToken: null,
      encryptedMetadata: "metadata-claude",
      label: "Claude",
      expiresAt: 1_700_000_200_000,
      lastRefreshedAt: null,
      lastErrorMessage: null,
      updatedAt: 1_700_000_200_100,
    });

    expect(getSandboxProviderCredentialByProviderId(db, "claude-code")).toMatchObject({
      encryptedAccessToken: "access-claude",
      encryptedRefreshToken: "refresh-claude",
      encryptedIdToken: null,
      encryptedMetadata: "metadata-claude",
      providerId: "claude-code",
    });
    expect(deleteSandboxProviderCredentialByProviderId(db, "claude-code")).toBe(true);
    expect(getSandboxProviderCredentialByProviderId(db, "claude-code")).toBeNull();
    expect(deleteSandboxProviderCredentialByProviderId(db, "claude-code")).toBe(false);
  });
});
