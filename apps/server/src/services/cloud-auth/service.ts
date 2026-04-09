import {
  createCloudAuthAttemptId,
  deleteSandboxProviderCredentialByProviderId,
  getSandboxProviderCredentialByProviderId,
  listSandboxProviderCredentials,
  upsertSandboxProviderCredential,
  type DbConnection,
  type SandboxProviderCredentialRecord,
} from "@bb/db";
import type {
  CloudAuthAttemptResponse,
  CloudAuthConnectResponse,
  CloudAuthConnection,
  CloudAuthProviderId,
} from "@bb/server-contract";
import { createAsyncDeduper } from "../lib/async-deduper.js";
import { startOAuthCallbackServer, type OAuthCallbackServer } from "./callback-server.js";
import { createCloudAuthCrypto } from "./crypto.js";
import {
  getCloudAuthProviderDefinition,
  listCloudAuthProviderDefinitions,
  storedCloudAuthCredentialSchema,
  type StoredCloudAuthCredential,
} from "./provider-definitions.js";
import type { CloudAuthService } from "./types.js";
import type { ServerLogger } from "../../types.js";

const ATTEMPT_RETENTION_MS = 10 * 60_000;
const ATTEMPT_TIMEOUT_MS = 10 * 60_000;
const REFRESH_SKEW_MS = 5 * 60_000;

interface CreateCloudAuthServiceArgs {
  dataDir: string;
  db: DbConnection;
  logger: ServerLogger;
}

interface CloudAuthAttemptState {
  attempt: CloudAuthAttemptResponse;
  callbackServer: OAuthCallbackServer | null;
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  expiresTimer: ReturnType<typeof setTimeout> | null;
}

interface PersistCredentialArgs {
  credential: StoredCloudAuthCredential;
  lastErrorMessage: string | null;
  updatedAt?: number;
}

function getConnectionLabel(
  credential: StoredCloudAuthCredential,
): string | null {
  switch (credential.providerId) {
    case "claude-code":
      return getCloudAuthProviderDefinition("claude-code").getConnectionLabel(
        credential,
      );
    case "codex":
      return getCloudAuthProviderDefinition("codex").getConnectionLabel(
        credential,
      );
  }
}

async function refreshCredential(
  credential: StoredCloudAuthCredential,
): Promise<StoredCloudAuthCredential> {
  switch (credential.providerId) {
    case "claude-code":
      return getCloudAuthProviderDefinition("claude-code").refreshCredential({
        credential,
      });
    case "codex":
      return getCloudAuthProviderDefinition("codex").refreshCredential({
        credential,
      });
  }
}

async function createAuthorizationFlow(
  providerId: CloudAuthProviderId,
): Promise<{
  authorizationUrl: string;
  state: string;
  verifier: string;
}> {
  switch (providerId) {
    case "claude-code":
      return getCloudAuthProviderDefinition("claude-code").createAuthorizationFlow();
    case "codex":
      return getCloudAuthProviderDefinition("codex").createAuthorizationFlow();
  }
}

function getCallbackConfig(providerId: CloudAuthProviderId): {
  errorTitle: string;
  listenHost: string;
  path: string;
  port: number;
  successTitle: string;
} {
  switch (providerId) {
    case "claude-code":
      return getCloudAuthProviderDefinition("claude-code").callback;
    case "codex":
      return getCloudAuthProviderDefinition("codex").callback;
  }
}

async function exchangeCode(
  providerId: CloudAuthProviderId,
  args: {
    code: string;
    state: string;
    verifier: string;
  },
): Promise<StoredCloudAuthCredential> {
  switch (providerId) {
    case "claude-code":
      return getCloudAuthProviderDefinition("claude-code").exchangeCode(args);
    case "codex":
      return getCloudAuthProviderDefinition("codex").exchangeCode(args);
  }
}

export async function createCloudAuthService(
  args: CreateCloudAuthServiceArgs,
): Promise<CloudAuthService> {
  const crypto = await createCloudAuthCrypto({ dataDir: args.dataDir });
  const refreshDeduper = createAsyncDeduper<CloudAuthProviderId, StoredCloudAuthCredential>();
  const attemptsById = new Map<string, CloudAuthAttemptState>();
  const pendingAttemptIdsByProvider = new Map<CloudAuthProviderId, string>();

  function clearAttemptTimers(attemptState: CloudAuthAttemptState): void {
    if (attemptState.cleanupTimer) {
      clearTimeout(attemptState.cleanupTimer);
      attemptState.cleanupTimer = null;
    }
    if (attemptState.expiresTimer) {
      clearTimeout(attemptState.expiresTimer);
      attemptState.expiresTimer = null;
    }
  }

  function scheduleAttemptCleanup(attemptId: string): void {
    const attemptState = attemptsById.get(attemptId);
    if (!attemptState) {
      return;
    }

    if (attemptState.cleanupTimer) {
      clearTimeout(attemptState.cleanupTimer);
    }

    attemptState.cleanupTimer = setTimeout(() => {
      const current = attemptsById.get(attemptId);
      if (!current) {
        return;
      }
      void current.callbackServer?.close().catch(() => undefined);
      attemptsById.delete(attemptId);
    }, ATTEMPT_RETENTION_MS);
    attemptState.cleanupTimer.unref();
  }

  async function closeAttemptCallbackServer(attemptId: string): Promise<void> {
    const attemptState = attemptsById.get(attemptId);
    const callbackServer = attemptState?.callbackServer;
    if (!callbackServer) {
      return;
    }
    attemptState.callbackServer = null;
    await callbackServer.close().catch(() => undefined);
  }

  function finalizeAttempt(args: {
    attemptId: string;
    errorMessage: string | null;
    status: CloudAuthAttemptResponse["status"];
  }): void {
    const attemptState = attemptsById.get(args.attemptId);
    if (!attemptState) {
      return;
    }

    clearAttemptTimers(attemptState);
    attemptState.attempt = {
      ...attemptState.attempt,
      errorMessage: args.errorMessage,
      status: args.status,
    };

    if (pendingAttemptIdsByProvider.get(attemptState.attempt.providerId) === args.attemptId) {
      pendingAttemptIdsByProvider.delete(attemptState.attempt.providerId);
    }

    scheduleAttemptCleanup(args.attemptId);
  }

  async function persistCredential(argsPersist: PersistCredentialArgs): Promise<void> {
    const encryptedPayload = crypto.encryptJson({
      plaintext: JSON.stringify(argsPersist.credential),
    });
    upsertSandboxProviderCredential(args.db, {
      encryptedPayload,
      expiresAt: argsPersist.credential.expiresAt,
      label: getConnectionLabel(argsPersist.credential),
      lastErrorMessage: argsPersist.lastErrorMessage,
      lastRefreshedAt: argsPersist.updatedAt ?? Date.now(),
      providerId: argsPersist.credential.providerId,
      updatedAt: argsPersist.updatedAt,
    });
  }

  function readCredential(
    record: SandboxProviderCredentialRecord,
  ): StoredCloudAuthCredential {
    return crypto.decryptJson({
      payload: record.encryptedPayload,
      schema: storedCloudAuthCredentialSchema,
    });
  }

  async function getCredentialRecord(
    providerId: CloudAuthProviderId,
  ): Promise<SandboxProviderCredentialRecord | null> {
    return getSandboxProviderCredentialByProviderId(args.db, providerId);
  }

  async function getValidCredential(
    providerId: CloudAuthProviderId,
  ): Promise<StoredCloudAuthCredential | null> {
    const record = await getCredentialRecord(providerId);
    if (!record) {
      return null;
    }

    let credential: StoredCloudAuthCredential;
    try {
      credential = readCredential(record);
    } catch (error) {
      upsertSandboxProviderCredential(args.db, {
        encryptedPayload: record.encryptedPayload,
        expiresAt: record.expiresAt,
        label: record.label,
        lastErrorMessage:
          error instanceof Error ? error.message : "Failed to decrypt credential",
        lastRefreshedAt: record.lastRefreshedAt,
        providerId: record.providerId,
        updatedAt: record.updatedAt,
      });
      return null;
    }

    if (credential.expiresAt > Date.now() + REFRESH_SKEW_MS) {
      if (record.lastErrorMessage) {
        await persistCredential({
          credential,
          lastErrorMessage: null,
          updatedAt: Date.now(),
        });
      }
      return credential;
    }

    return refreshDeduper.run(providerId, async () => {
      const currentRecord = await getCredentialRecord(providerId);
      if (!currentRecord) {
        throw new Error(`Missing credential for ${providerId}`);
      }

      const currentCredential = readCredential(currentRecord);
      if (currentCredential.expiresAt > Date.now() + REFRESH_SKEW_MS) {
        return currentCredential;
      }

      try {
        const refreshedCredential = await refreshCredential(currentCredential);
        await persistCredential({
          credential: refreshedCredential,
          lastErrorMessage: null,
          updatedAt: Date.now(),
        });
        return refreshedCredential;
      } catch (error) {
        upsertSandboxProviderCredential(args.db, {
          encryptedPayload: currentRecord.encryptedPayload,
          expiresAt: currentRecord.expiresAt,
          label: currentRecord.label,
          lastErrorMessage:
            error instanceof Error ? error.message : "Credential refresh failed",
          lastRefreshedAt: currentRecord.lastRefreshedAt,
          providerId: currentRecord.providerId,
          updatedAt: Date.now(),
        });
        args.logger.warn(
          {
            err: error,
            providerId,
          },
          "Failed to refresh sandbox provider credential",
        );
        return currentCredential;
      }
    });
  }

  async function startConnection(
    providerId: CloudAuthProviderId,
  ): Promise<CloudAuthConnectResponse> {
    const previousAttemptId = pendingAttemptIdsByProvider.get(providerId);
    if (previousAttemptId) {
      finalizeAttempt({
        attemptId: previousAttemptId,
        errorMessage: "Superseded by a newer connection attempt",
        status: "expired",
      });
      await closeAttemptCallbackServer(previousAttemptId);
    }

    const flow = await createAuthorizationFlow(providerId);
    const callback = getCallbackConfig(providerId);
    const callbackServer = await startOAuthCallbackServer({
      errorTitle: callback.errorTitle,
      expectedState: flow.state,
      listenHost: callback.listenHost,
      path: callback.path,
      port: callback.port,
      successTitle: callback.successTitle,
    });
    const attemptId = createCloudAuthAttemptId();
    const attemptState: CloudAuthAttemptState = {
      attempt: {
        attemptId,
        errorMessage: null,
        providerId,
        status: "pending",
      },
      callbackServer,
      cleanupTimer: null,
      expiresTimer: null,
    };
    attemptsById.set(attemptId, attemptState);
    pendingAttemptIdsByProvider.set(providerId, attemptId);

    attemptState.expiresTimer = setTimeout(() => {
      const currentAttempt = attemptsById.get(attemptId);
      if (!currentAttempt || currentAttempt.attempt.status !== "pending") {
        return;
      }
      currentAttempt.callbackServer?.cancelWait();
      finalizeAttempt({
        attemptId,
        errorMessage: "The connection attempt timed out before the provider redirected back.",
        status: "expired",
      });
      void closeAttemptCallbackServer(attemptId);
    }, ATTEMPT_TIMEOUT_MS);
    attemptState.expiresTimer.unref();

    void callbackServer.waitForCode()
      .then(async (callbackPayload) => {
        if (!callbackPayload) {
          return;
        }
        const currentAttempt = attemptsById.get(attemptId);
        if (!currentAttempt || currentAttempt.attempt.status !== "pending") {
          return;
        }

        const credential = await exchangeCode(providerId, {
          code: callbackPayload.code,
          state: callbackPayload.state,
          verifier: flow.verifier,
        });
        await persistCredential({
          credential,
          lastErrorMessage: null,
          updatedAt: Date.now(),
        });
        finalizeAttempt({
          attemptId,
          errorMessage: null,
          status: "completed",
        });
      })
      .catch((error) => {
        finalizeAttempt({
          attemptId,
          errorMessage:
            error instanceof Error ? error.message : "Cloud auth exchange failed",
          status: "failed",
        });
      })
      .finally(() => closeAttemptCallbackServer(attemptId));

    return {
      attemptId,
      authorizationUrl: flow.authorizationUrl,
    };
  }

  async function listConnections(): Promise<CloudAuthConnection[]> {
    const recordsByProvider = new Map(
      listSandboxProviderCredentials(args.db).map((record) => [record.providerId, record]),
    );

    return listCloudAuthProviderDefinitions().map((provider) => {
      const record = recordsByProvider.get(provider.id);
      if (!record) {
        return {
          connectedAt: null,
          displayName: provider.displayName,
          errorMessage: null,
          expiresAt: null,
          label: null,
          lastRefreshedAt: null,
          providerId: provider.id,
          status: "missing",
        };
      }

      return {
        connectedAt: record.updatedAt,
        displayName: provider.displayName,
        errorMessage: record.lastErrorMessage,
        expiresAt: record.expiresAt,
        label: record.label,
        lastRefreshedAt: record.lastRefreshedAt,
        providerId: provider.id,
        status: record.lastErrorMessage ? "invalid" : "connected",
      };
    });
  }

  return {
    async disconnectProvider({ providerId }) {
      const pendingAttemptId = pendingAttemptIdsByProvider.get(providerId);
      if (pendingAttemptId) {
        finalizeAttempt({
          attemptId: pendingAttemptId,
          errorMessage: "Canceled by credential removal",
          status: "expired",
        });
        await closeAttemptCallbackServer(pendingAttemptId);
      }
      return deleteSandboxProviderCredentialByProviderId(args.db, providerId);
    },
    async dispose() {
      for (const [attemptId, attemptState] of attemptsById) {
        clearAttemptTimers(attemptState);
        await closeAttemptCallbackServer(attemptId);
        attemptsById.delete(attemptId);
      }
    },
    getAttempt({ attemptId }) {
      return attemptsById.get(attemptId)?.attempt ?? null;
    },
    async getValidCredential({ providerId }) {
      return getValidCredential(providerId);
    },
    async listConnections() {
      return listConnections();
    },
    async startConnection({ providerId }) {
      return startConnection(providerId);
    },
  };
}
