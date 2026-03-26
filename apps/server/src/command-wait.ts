import type { HostDaemonCommandType } from "@bb/host-daemon-contract";
import { queueCommand, getActiveSession } from "@bb/db";
import type { DbConnection } from "@bb/db";
import { ApiError } from "./errors.js";
import type { NotificationHub, CommandWaitResult } from "./ws/hub.js";

const DEFAULT_TIMEOUT_MS = 30_000;
const PROVISION_TIMEOUT_MS = 300_000;

export interface QueueCommandAndWaitOptions {
  db: DbConnection;
  hub: NotificationHub;
  hostId: string;
  command: { type: HostDaemonCommandType; [key: string]: unknown };
  timeoutMs?: number;
}

export function getCommandTimeout(commandType: string): number {
  if (commandType === "environment.provision") return PROVISION_TIMEOUT_MS;
  return DEFAULT_TIMEOUT_MS;
}

export async function queueCommandAndWait(
  options: QueueCommandAndWaitOptions,
): Promise<CommandWaitResult> {
  const { db, hub, hostId, command } = options;
  const timeoutMs = options.timeoutMs ?? getCommandTimeout(command.type);

  if (!hub.isDaemonConnected(hostId)) {
    throw new ApiError(502, "host_disconnected", "Host is not connected");
  }

  const session = getActiveSession(db, hostId);
  if (!session) {
    throw new ApiError(502, "host_disconnected", "Host has no active session");
  }

  const queued = queueCommand(db, hub, {
    hostId,
    sessionId: session.id,
    type: command.type,
    payload: JSON.stringify(command),
  });

  hub.notifyCommand(hostId);

  const result = await hub.waitForCommandResult(queued.id, timeoutMs);
  if (!result.ok && result.errorCode === "command_timeout") {
    throw new ApiError(504, "command_timeout", result.errorMessage ?? "Command timed out");
  }

  return result;
}
