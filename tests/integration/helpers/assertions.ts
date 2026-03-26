import fs from "node:fs/promises";
import { and, eq, or } from "drizzle-orm";
import {
  hostDaemonCommands,
  type DbConnection,
} from "@bb/db";
import type {
  Environment,
  EnvironmentStatus,
  Host,
  Thread,
  ThreadEventRow,
  ThreadStatus,
} from "@bb/domain";
import {
  hostDaemonCommandSchema,
  type HostDaemonCommand,
} from "@bb/host-daemon-contract";
import { createPublicApiClient } from "@bb/server-contract";

const POLL_INTERVAL_MS = 100;

export interface QueuedCommand {
  command: HostDaemonCommand;
  completedAt: number | null;
  createdAt: number;
  cursor: number;
  fetchedAt: number | null;
  hostId: string;
  id: string;
  payload: string;
  retryCount: number;
  sessionId: string | null;
  state: string;
  type: string;
}

type PublicApiClient = ReturnType<typeof createPublicApiClient>;
async function pollUntil<T>(
  check: () => Promise<T | null>,
  expectation: string,
  timeoutMs: number,
  getCurrentState: () => string,
): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= timeoutMs) {
    const value = await check();
    if (value) {
      return value;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }

  throw new Error(`${expectation}. Current state: ${getCurrentState()}`);
}

async function readThread(
  api: PublicApiClient,
  threadId: string,
): Promise<Thread> {
  const response = await api.threads[":id"].$get({
    param: { id: threadId },
  });
  if (response.status !== 200) {
    throw new Error(`Expected thread ${threadId} to exist, got ${response.status}`);
  }
  return response.json();
}

async function readThreadEvents(
  api: PublicApiClient,
  threadId: string,
): Promise<ThreadEventRow[]> {
  const response = await api.threads[":id"].events.$get({
    param: { id: threadId },
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected thread events for ${threadId}, got ${response.status}`,
    );
  }
  return response.json();
}

async function readHost(
  api: PublicApiClient,
  hostId: string,
): Promise<Host> {
  const response = await api.hosts[":id"].$get({
    param: { id: hostId },
  });
  if (response.status !== 200) {
    throw new Error(`Expected host ${hostId} to exist, got ${response.status}`);
  }
  return response.json();
}

async function readEnvironment(
  api: PublicApiClient,
  environmentId: string,
): Promise<Environment> {
  const response = await api.environments[":id"].$get({
    param: { id: environmentId },
  });
  if (response.status !== 200) {
    throw new Error(
      `Expected environment ${environmentId} to exist, got ${response.status}`,
    );
  }
  return response.json();
}

export async function waitForThreadStatus(
  api: PublicApiClient,
  threadId: string,
  status: ThreadStatus,
  timeoutMs = 10_000,
): Promise<Thread> {
  let currentStatus = "unknown";
  return pollUntil(
    async () => {
      const thread = await readThread(api, threadId);
      currentStatus = thread.status;
      return thread.status === status ? thread : null;
    },
    `Timed out waiting for thread ${threadId} to reach status ${status}`,
    timeoutMs,
    () => currentStatus,
  );
}

export async function waitForEvents(
  api: PublicApiClient,
  threadId: string,
  minCount: number,
  timeoutMs = 10_000,
): Promise<ThreadEventRow[]> {
  let currentCount = 0;
  return pollUntil(
    async () => {
      const events = await readThreadEvents(api, threadId);
      currentCount = events.length;
      return events.length >= minCount ? events : null;
    },
    `Timed out waiting for ${minCount} events on thread ${threadId}`,
    timeoutMs,
    () => `${currentCount} events`,
  );
}

export async function waitForEventType(
  api: PublicApiClient,
  threadId: string,
  eventType: string,
  timeoutMs = 10_000,
): Promise<ThreadEventRow> {
  let lastTypes = "none";
  return pollUntil(
    async () => {
      const events = await readThreadEvents(api, threadId);
      lastTypes = events.map((event) => event.type).join(", ") || "none";
      return events.find((event) => event.type === eventType) ?? null;
    },
    `Timed out waiting for event ${eventType} on thread ${threadId}`,
    timeoutMs,
    () => lastTypes,
  );
}

export async function waitForHostConnected(
  api: PublicApiClient,
  timeoutMs = 10_000,
): Promise<Host> {
  let currentHosts = "none";
  return pollUntil(
    async () => {
      const response = await api.hosts.$get({});
      if (response.status !== 200) {
        throw new Error(`Expected hosts list, got ${response.status}`);
      }
      const hosts: Host[] = await response.json();
      currentHosts =
        hosts.map((host) => `${host.id}:${host.status}`).join(", ") || "none";
      return hosts.find((host) => host.status === "connected") ?? null;
    },
    "Timed out waiting for a connected host",
    timeoutMs,
    () => currentHosts,
  );
}

export async function waitForHostDisconnected(
  api: PublicApiClient,
  hostId: string,
  timeoutMs = 10_000,
): Promise<void> {
  let currentStatus = "unknown";
  await pollUntil(
    async () => {
      const host = await readHost(api, hostId);
      currentStatus = host.status;
      return host.status === "disconnected" ? host : null;
    },
    `Timed out waiting for host ${hostId} to disconnect`,
    timeoutMs,
    () => currentStatus,
  );
}

export async function waitForEnvironmentStatus(
  api: PublicApiClient,
  environmentId: string,
  status: EnvironmentStatus,
  timeoutMs = 10_000,
): Promise<Environment> {
  let currentStatus = "unknown";
  return pollUntil(
    async () => {
      const environment = await readEnvironment(api, environmentId);
      currentStatus = environment.status;
      return environment.status === status ? environment : null;
    },
    `Timed out waiting for environment ${environmentId} to reach ${status}`,
    timeoutMs,
    () => currentStatus,
  );
}

export async function waitForPathRemoval(
  pathToCheck: string,
  timeoutMs = 10_000,
): Promise<void> {
  await pollUntil(
    async () => {
      try {
        await fs.access(pathToCheck);
        return null;
      } catch {
        return true;
      }
    },
    `Timed out waiting for ${pathToCheck} to be removed`,
    timeoutMs,
    () => "path still exists",
  );
}

function toQueuedCommand(
  row: typeof hostDaemonCommands.$inferSelect,
): QueuedCommand {
  return {
    command: hostDaemonCommandSchema.parse(JSON.parse(row.payload)),
    completedAt: row.completedAt ?? null,
    createdAt: row.createdAt,
    cursor: row.cursor,
    fetchedAt: row.fetchedAt ?? null,
    hostId: row.hostId,
    id: row.id,
    payload: row.payload,
    retryCount: row.retryCount,
    sessionId: row.sessionId ?? null,
    state: row.state,
    type: row.type,
  };
}

export async function waitForCommand(
  db: DbConnection,
  predicate: (command: QueuedCommand) => boolean,
  timeoutMs = 10_000,
): Promise<QueuedCommand> {
  let currentCommands = "none";
  return pollUntil(
    async () => {
      const rows = db
        .select()
        .from(hostDaemonCommands)
        .orderBy(hostDaemonCommands.cursor)
        .all();
      const commands = rows.map(toQueuedCommand);
      currentCommands =
        commands.map((command) => `${command.cursor}:${command.type}`).join(", ") ||
        "none";
      return commands.find(predicate) ?? null;
    },
    "Timed out waiting for a matching command",
    timeoutMs,
    () => currentCommands,
  );
}

export async function waitForCommandsDrained(
  db: DbConnection,
  hostId: string,
  timeoutMs = 10_000,
): Promise<void> {
  let pendingCount = -1;
  await pollUntil(
    async () => {
      const rows = db
        .select()
        .from(hostDaemonCommands)
        .where(
          and(
            eq(hostDaemonCommands.hostId, hostId),
            or(
              eq(hostDaemonCommands.state, "pending"),
              eq(hostDaemonCommands.state, "fetched"),
            ),
          ),
        )
        .all();
      pendingCount = rows.length;
      return rows.length === 0 ? rows : null;
    },
    `Timed out waiting for host ${hostId} commands to drain`,
    timeoutMs,
    () => `${pendingCount} pending commands`,
  );
}
