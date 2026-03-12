import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { resolveBeanbagPath } from "@beanbag/agent-core/storage-paths";
import type { EnvironmentAgentSessionRepository } from "@beanbag/db";
import type { Orchestrator } from "./orchestrator.js";

interface StartupTaskLogger {
  log(message: string): void;
  warn(message: string): void;
}

// Defer startup maintenance until the daemon is already serving requests.
export function scheduleManagedArtifactReconciliation(
  threadManager: Pick<Orchestrator, "reconcileManagedArtifacts">,
  logger: StartupTaskLogger = console,
): void {
  const task = setImmediate(() => {
    logger.log("Reconciling managed storage artifacts in background...");
    void threadManager.reconcileManagedArtifacts()
      .then(() => {
        logger.log("Managed artifact reconciliation complete.");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Managed artifact cleanup skipped: ${message}`);
      });
  });
  task.unref();
}

interface ManagedEnvironmentAgentStateRecord {
  version: 1;
  baseUrl: string;
  authToken: string;
  threadId: string;
  projectId: string;
  environmentId: string;
}

function isManagedEnvironmentAgentStateRecord(
  value: unknown,
): value is ManagedEnvironmentAgentStateRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return record.version === 1 &&
    typeof record.baseUrl === "string" &&
    typeof record.authToken === "string" &&
    typeof record.threadId === "string" &&
    typeof record.projectId === "string" &&
    typeof record.environmentId === "string";
}

function listManagedEnvironmentAgentStateRecords(
  runtimeEnv: NodeJS.ProcessEnv,
): ManagedEnvironmentAgentStateRecord[] {
  const root = resolveBeanbagPath(runtimeEnv, "environment-agents");
  let projectDirs: string[] = [];
  try {
    projectDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }

  const records: ManagedEnvironmentAgentStateRecord[] = [];
  for (const projectDir of projectDirs) {
    let entries: string[] = [];
    try {
      entries = readdirSync(projectDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => join(projectDir, entry.name));
    } catch {
      continue;
    }
    for (const filePath of entries) {
      try {
        const parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
        if (isManagedEnvironmentAgentStateRecord(parsed)) {
          records.push(parsed);
        }
      } catch {
        continue;
      }
    }
  }
  return records;
}

async function requestEnvironmentAgentSessionSync(
  record: ManagedEnvironmentAgentStateRecord,
): Promise<boolean> {
  try {
    const response = await fetch(new URL("/control/session-sync", record.baseUrl), {
      method: "POST",
      headers: {
        authorization: `Bearer ${record.authToken}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    return response.status === 202;
  } catch {
    return false;
  }
}

export async function recoverManagedEnvironmentAgentSessionsOnBoot(args: {
  runtimeEnv: NodeJS.ProcessEnv;
  sessionRepo: Pick<
    EnvironmentAgentSessionRepository,
    "listActive" | "markClosed"
  >;
  logger?: StartupTaskLogger;
}): Promise<{
  activeSessionCount: number;
  pokedCount: number;
  closedCount: number;
}> {
  const logger = args.logger ?? console;
  const activeSessions = args.sessionRepo.listActive();
  if (activeSessions.length === 0) {
    return {
      activeSessionCount: 0,
      pokedCount: 0,
      closedCount: 0,
    };
  }

  const stateRecords = listManagedEnvironmentAgentStateRecords(args.runtimeEnv);
  const recordsByThreadId = new Map(
    stateRecords.map((record) => [record.threadId, record] as const),
  );

  let pokedCount = 0;
  let closedCount = 0;
  for (const session of activeSessions) {
    const record = recordsByThreadId.get(session.threadId);
    if (record && await requestEnvironmentAgentSessionSync(record)) {
      pokedCount += 1;
      continue;
    }
    args.sessionRepo.markClosed({
      sessionId: session.id,
      reason: "daemon_shutdown",
    });
    closedCount += 1;
  }

  logger.log(
    `Environment-agent startup recovery poked ${pokedCount}/${activeSessions.length} active sessions and closed ${closedCount} stale sessions.`,
  );
  return {
    activeSessionCount: activeSessions.length,
    pokedCount,
    closedCount,
  };
}
