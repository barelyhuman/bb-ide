import type {
  SandboxProviderCredentialRecord,
  UpsertSandboxProviderCredentialArgs,
} from "@bb/db";
import { z } from "zod";
import type { CloudAuthCrypto } from "./crypto.js";
import type {
  ClaudeStoredCredential,
  CodexStoredCredential,
  StoredCloudAuthCredential,
} from "./provider-definitions.js";
import {
  claudeSubscriptionTypeSchema,
  storedCloudAuthCredentialSchema,
} from "./provider-definitions.js";

const encryptedStringSchema = z.string();

const claudeCredentialMetadataSchema = z.object({
  accountEmail: z.string().min(1).nullable(),
  accountId: z.string().min(1).nullable(),
  scopes: z.array(z.string()),
  subscriptionType: claudeSubscriptionTypeSchema,
}).strict();

type ClaudeCredentialMetadata = z.infer<typeof claudeCredentialMetadataSchema>;

const codexCredentialMetadataSchema = z.object({
  accountId: z.string().min(1).nullable(),
}).strict();

type CodexCredentialMetadata = z.infer<typeof codexCredentialMetadataSchema>;

interface SerializeCloudAuthCredentialArgs {
  credential: StoredCloudAuthCredential;
  crypto: CloudAuthCrypto;
}

export interface SerializedCloudAuthCredential {
  encryptedAccessToken: string;
  encryptedRefreshToken: string;
  encryptedIdToken: string | null;
  encryptedMetadata: string;
}

interface DeserializeCloudAuthCredentialArgs {
  crypto: CloudAuthCrypto;
  record: SandboxProviderCredentialRecord;
}

export interface BuildSandboxProviderCredentialUpsertArgs {
  credential: StoredCloudAuthCredential;
  crypto: CloudAuthCrypto;
  label: string | null;
  lastErrorMessage: string | null;
  lastRefreshedAt: number | null;
  updatedAt: number;
}

function decryptStringValue(
  crypto: CloudAuthCrypto,
  encryptedValue: string,
): string {
  return crypto.decryptJson({
    payload: encryptedValue,
    schema: encryptedStringSchema,
  });
}

function encryptStringValue(
  crypto: CloudAuthCrypto,
  value: string,
): string {
  // The crypto helper encrypts JSON payloads, so raw strings are wrapped as JSON strings.
  return crypto.encryptJson({
    plaintext: JSON.stringify(value),
  });
}

function decryptMetadataValue<TValue>(
  crypto: CloudAuthCrypto,
  encryptedValue: string,
  schema: z.ZodType<TValue>,
): TValue {
  return crypto.decryptJson({
    payload: encryptedValue,
    schema,
  });
}

function encryptMetadataValue<TValue>(
  crypto: CloudAuthCrypto,
  value: TValue,
): string {
  return crypto.encryptJson({
    plaintext: JSON.stringify(value),
  });
}

function buildClaudeMetadata(
  credential: ClaudeStoredCredential,
): ClaudeCredentialMetadata {
  return {
    accountEmail: credential.accountEmail,
    accountId: credential.accountId,
    scopes: credential.scopes,
    subscriptionType: credential.subscriptionType,
  };
}

function buildCodexMetadata(
  credential: CodexStoredCredential,
): CodexCredentialMetadata {
  return {
    accountId: credential.accountId,
  };
}

function assertStoredCredentialShape(
  credential: StoredCloudAuthCredential,
): StoredCloudAuthCredential {
  return storedCloudAuthCredentialSchema.parse(credential);
}

export function serializeCloudAuthCredential(
  args: SerializeCloudAuthCredentialArgs,
): SerializedCloudAuthCredential {
  switch (args.credential.providerId) {
    case "claude-code":
      return {
        encryptedAccessToken: encryptStringValue(
          args.crypto,
          args.credential.accessToken,
        ),
        encryptedRefreshToken: encryptStringValue(
          args.crypto,
          args.credential.refreshToken,
        ),
        encryptedIdToken: null,
        encryptedMetadata: encryptMetadataValue(
          args.crypto,
          buildClaudeMetadata(args.credential),
        ),
      };
    case "codex":
      return {
        encryptedAccessToken: encryptStringValue(
          args.crypto,
          args.credential.accessToken,
        ),
        encryptedRefreshToken: encryptStringValue(
          args.crypto,
          args.credential.refreshToken,
        ),
        encryptedIdToken: args.credential.idToken
          ? encryptStringValue(args.crypto, args.credential.idToken)
          : null,
        encryptedMetadata: encryptMetadataValue(
          args.crypto,
          buildCodexMetadata(args.credential),
        ),
      };
  }
}

export function deserializeCloudAuthCredential(
  args: DeserializeCloudAuthCredentialArgs,
): StoredCloudAuthCredential {
  switch (args.record.providerId) {
    case "claude-code": {
      const metadata = decryptMetadataValue(
        args.crypto,
        args.record.encryptedMetadata,
        claudeCredentialMetadataSchema,
      );
      return assertStoredCredentialShape({
        accessToken: decryptStringValue(
          args.crypto,
          args.record.encryptedAccessToken,
        ),
        accountEmail: metadata.accountEmail,
        accountId: metadata.accountId,
        expiresAt: args.record.expiresAt,
        providerId: "claude-code",
        refreshToken: decryptStringValue(
          args.crypto,
          args.record.encryptedRefreshToken,
        ),
        scopes: metadata.scopes,
        subscriptionType: metadata.subscriptionType,
      });
    }
    case "codex": {
      const metadata = decryptMetadataValue(
        args.crypto,
        args.record.encryptedMetadata,
        codexCredentialMetadataSchema,
      );
      return assertStoredCredentialShape({
        accessToken: decryptStringValue(
          args.crypto,
          args.record.encryptedAccessToken,
        ),
        accountId: metadata.accountId,
        expiresAt: args.record.expiresAt,
        idToken: args.record.encryptedIdToken
          ? decryptStringValue(args.crypto, args.record.encryptedIdToken)
          : null,
        providerId: "codex",
        refreshToken: decryptStringValue(
          args.crypto,
          args.record.encryptedRefreshToken,
        ),
      });
    }
    default:
      throw new Error(
        `Unsupported sandbox provider credential ${args.record.providerId}`,
      );
  }
}

export function buildSandboxProviderCredentialUpsert(
  args: BuildSandboxProviderCredentialUpsertArgs,
): UpsertSandboxProviderCredentialArgs {
  const serialized = serializeCloudAuthCredential({
    credential: args.credential,
    crypto: args.crypto,
  });

  return {
    encryptedAccessToken: serialized.encryptedAccessToken,
    encryptedRefreshToken: serialized.encryptedRefreshToken,
    encryptedIdToken: serialized.encryptedIdToken,
    encryptedMetadata: serialized.encryptedMetadata,
    expiresAt: args.credential.expiresAt,
    label: args.label,
    lastErrorMessage: args.lastErrorMessage,
    lastRefreshedAt: args.lastRefreshedAt,
    providerId: args.credential.providerId,
    updatedAt: args.updatedAt,
  };
}
