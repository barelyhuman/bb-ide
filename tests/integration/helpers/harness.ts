import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { serve } from "@hono/node-server";
import { createFakeAdapter } from "@bb/agent-runtime/test";
import type { AgentRuntimeOptions } from "@bb/agent-runtime";
import type { DbConnection } from "@bb/db";
import { createHostDaemonClient } from "@bb/host-daemon-contract";
import { createPublicApiClient } from "@bb/server-contract";
import { createHostDaemonApp, type HostDaemonApp } from "../../../apps/host-daemon/src/app.js";
import type { HostDaemon } from "../../../apps/host-daemon/src/daemon.js";
import { loadHostIdentity } from "../../../apps/host-daemon/src/identity.js";
import { acquireDaemonLock } from "../../../apps/host-daemon/src/lock.js";
import { initDb } from "../../../apps/server/src/db.js";
import { createApp } from "../../../apps/server/src/server.js";
import type { ServerRuntimeConfig } from "../../../apps/server/src/types.js";
import { NotificationHub } from "../../../apps/server/src/ws/hub.js";
import { waitForHostConnected } from "./assertions.js";
import { createTestGitRepo } from "./seed.js";

export const TEST_AUTH_TOKEN = "test-secret-token";

type PublicApiClient = ReturnType<typeof createPublicApiClient>;
type InternalHostDaemonClient = ReturnType<typeof createHostDaemonClient>;

const testLogger = {
  error(): void {},
  info(): void {},
  warn(): void {},
};

export interface RunningTestServer {
  baseUrl: string;
  close(): Promise<void>;
  config: ServerRuntimeConfig;
  db: DbConnection;
  hub: NotificationHub;
}

export interface IntegrationHarness {
  api: PublicApiClient;
  cleanup(): Promise<void>;
  daemon: HostDaemon;
  daemonApp: HostDaemonApp;
  db: DbConnection;
  hostId: string;
  hub: NotificationHub;
  internal: InternalHostDaemonClient;
  repoDir: string;
  server: RunningTestServer;
  serverUrl: string;
}

export interface CreateHarnessOptions {
  adapterFactory?: AgentRuntimeOptions["adapterFactory"];
}

interface HarnessDaemonResources {
  daemon: HostDaemon;
  daemonApp: HostDaemonApp;
  hostId: string;
}

interface ListeningAddress {
  port: number;
}

function requireListeningAddress(
  address: ListeningAddress | null,
): ListeningAddress {
  if (!address) {
    throw new Error("Server address was not assigned");
  }
  return address;
}

function hasAdapterFactoryOverride(
  options: CreateHarnessOptions,
): boolean {
  return Object.prototype.hasOwnProperty.call(options, "adapterFactory");
}

function resolveAdapterFactory(
  options: CreateHarnessOptions,
): AgentRuntimeOptions["adapterFactory"] | undefined {
  if (hasAdapterFactoryOverride(options)) {
    return options.adapterFactory;
  }
  return () => createFakeAdapter();
}

async function startIntegrationServer(
  tmpRoot: string,
): Promise<RunningTestServer> {
  const serverDataDir = path.join(tmpRoot, "server-data");
  await fs.mkdir(serverDataDir, { recursive: true });

  const db = initDb(":memory:");
  const hub = new NotificationHub();
  const config: ServerRuntimeConfig = {
    authToken: TEST_AUTH_TOKEN,
    dataDir: serverDataDir,
    hostDaemonPort: null,
    inferenceModel: "test/mock-model",
    openAiApiKey: process.env.OPENAI_API_KEY ?? "test-openai-key",
    serverUrl: "http://127.0.0.1:0",
  };
  const { app, injectWebSocket } = createApp({
    config,
    db,
    hub,
    logger: testLogger,
  });

  let addressInfo: ListeningAddress | null = null;
  const server = serve(
    {
      port: 0,
      fetch: app.fetch,
    },
    (info) => {
      addressInfo = { port: info.port };
    },
  );
  injectWebSocket(server);

  while (!addressInfo) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  const baseUrl = `http://127.0.0.1:${requireListeningAddress(addressInfo).port}`;
  config.serverUrl = baseUrl;

  return {
    baseUrl,
    config,
    db,
    hub,
    async close(): Promise<void> {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

async function startHarnessDaemon(
  dataDir: string,
  serverUrl: string,
  options: CreateHarnessOptions,
): Promise<HarnessDaemonResources> {
  const releaseLock = await acquireDaemonLock(dataDir);

  try {
    const identity = await loadHostIdentity({ dataDir });
    const daemonApp = await createHostDaemonApp({
      adapterFactory: resolveAdapterFactory(options),
      authToken: TEST_AUTH_TOKEN,
      dataDir,
      enableLocalApi: false,
      hostId: identity.hostId,
      hostName: identity.hostName,
      hostType: "persistent",
      instanceId: randomUUID(),
      localApiPort: 0,
      logger: testLogger,
      releaseLock,
      restart: async () => undefined,
      serverUrl,
    });
    await daemonApp.daemon.start();
    return {
      daemon: daemonApp.daemon,
      daemonApp,
      hostId: identity.hostId,
    };
  } catch (error) {
    await releaseLock().catch(() => undefined);
    throw error;
  }
}

export async function createIntegrationHarness(
  options: CreateHarnessOptions = {},
): Promise<IntegrationHarness> {
  const tmpRoot = await fs.mkdtemp(path.join(tmpdir(), "bb-integration-"));
  const reposRoot = path.join(tmpRoot, "repos");
  const repoDir = await createTestGitRepo({
    repoDir: path.join(reposRoot, "test-project"),
  });

  let server: RunningTestServer | null = null;
  let daemonResources: HarnessDaemonResources | null = null;
  let cleanedUp = false;

  async function cleanup(): Promise<void> {
    if (cleanedUp) {
      return;
    }
    cleanedUp = true;

    await daemonResources?.daemon.shutdown("integration-cleanup").catch(
      () => undefined,
    );
    await server?.close().catch(() => undefined);
    await fs.rm(tmpRoot, { recursive: true, force: true });
  }

  try {
    server = await startIntegrationServer(tmpRoot);
    daemonResources = await startHarnessDaemon(
      path.join(tmpRoot, "daemon-data"),
      server.baseUrl,
      options,
    );

    const api = createPublicApiClient(server.baseUrl);
    await waitForHostConnected(api);

    return {
      api,
      cleanup,
      daemon: daemonResources.daemon,
      daemonApp: daemonResources.daemonApp,
      db: server.db,
      hostId: daemonResources.hostId,
      hub: server.hub,
      internal: createHostDaemonClient(server.baseUrl, TEST_AUTH_TOKEN),
      repoDir,
      server,
      serverUrl: server.baseUrl,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
