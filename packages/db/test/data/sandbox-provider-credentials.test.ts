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
      encryptedPayload: "ciphertext-1",
      label: "first",
      expiresAt: 1_700_000_000_000,
      lastRefreshedAt: 1_700_000_000_100,
      lastErrorMessage: null,
      updatedAt: 1_700_000_000_200,
    });
    const second = upsertSandboxProviderCredential(db, {
      providerId: "codex",
      encryptedPayload: "ciphertext-2",
      label: "second",
      expiresAt: 1_700_000_100_000,
      lastRefreshedAt: 1_700_000_100_100,
      lastErrorMessage: "refresh failed",
      updatedAt: 1_700_000_100_200,
    });

    expect(second.id).toBe(first.id);
    expect(second.encryptedPayload).toBe("ciphertext-2");
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
      encryptedPayload: "ciphertext-claude",
      label: "Claude",
      expiresAt: null,
      lastRefreshedAt: null,
      lastErrorMessage: null,
    });

    expect(getSandboxProviderCredentialByProviderId(db, "claude-code")).toMatchObject({
      encryptedPayload: "ciphertext-claude",
      providerId: "claude-code",
    });
    expect(deleteSandboxProviderCredentialByProviderId(db, "claude-code")).toBe(true);
    expect(getSandboxProviderCredentialByProviderId(db, "claude-code")).toBeNull();
    expect(deleteSandboxProviderCredentialByProviderId(db, "claude-code")).toBe(false);
  });
});
