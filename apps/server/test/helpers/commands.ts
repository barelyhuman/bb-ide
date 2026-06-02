import { setTimeout as sleep } from "node:timers/promises";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  fetchCommands,
  getActiveCommandAttemptForCommand,
  getCommand,
  hostDaemonCommands,
  hostDaemonSessions,
} from "@bb/db";
import {
  hostDaemonCommandResultSchemaByType,
  hostDaemonCommandSchema,
  hostDaemonOnlineRpcCommandSchema,
  hostDaemonOnlineRpcResultSchemaByType,
  hostDaemonServerWsMessageSchema,
} from "@bb/host-daemon-contract";
import {
  CLIENT_TURN_REQUEST_ID_ALPHABET,
  hostDaemonProducerEventIdSchema,
  type HostDaemonProducerEventId,
  type HostType,
  type ThreadEvent,
} from "@bb/domain";
import type {
  HostDaemonCommand,
  HostDaemonCommandResultByType,
  HostDaemonEventEnvelope,
  HostDaemonOnlineRpcCommand,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResultByType,
} from "@bb/host-daemon-contract";
import type { TestAppHarness } from "./test-app.js";
import { createTestDaemonHostKey } from "./test-app.js";

type HostDaemonCommandRow = typeof hostDaemonCommands.$inferSelect;

type QueuedCommandPayload = HostDaemonCommand | HostDaemonOnlineRpcCommand;
type QueuedCommandResult<TCommand extends QueuedCommandPayload> =
  TCommand extends HostDaemonCommand
    ? HostDaemonCommandResultByType[TCommand["type"]]
    : TCommand extends HostDaemonOnlineRpcCommand
      ? HostDaemonOnlineRpcResultByType[TCommand["type"]]
      : never;

export interface QueuedCommand<
  TCommand extends QueuedCommandPayload = QueuedCommandPayload,
> {
  command: TCommand;
  row: HostDaemonCommandRow;
  rpcRequest?: HostDaemonOnlineRpcRequestMessage;
}

export interface EnsureCommandDeliveredArgs {
  commandId: string;
  hostId: string;
  sessionId: string | null;
}

type ManagedWorktreeEnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision"; workspaceProvisionType: "managed-worktree" }
>;

export type ManagedWorktreeEnvironmentProvisionQueuedCommand =
  QueuedCommand<ManagedWorktreeEnvironmentProvisionCommand>;

export function isManagedWorktreeEnvironmentProvisionQueuedCommand(
  queued: QueuedCommand,
): queued is ManagedWorktreeEnvironmentProvisionQueuedCommand {
  return (
    queued.command.type === "environment.provision" &&
    queued.command.workspaceProvisionType === "managed-worktree"
  );
}

export function requireManagedWorktreeEnvironmentProvisionQueuedCommand(
  queued: QueuedCommand,
): ManagedWorktreeEnvironmentProvisionQueuedCommand {
  if (isManagedWorktreeEnvironmentProvisionQueuedCommand(queued)) {
    return queued;
  }
  throw new Error("Expected managed-worktree environment.provision command");
}

export function listQueuedThreadCommands(
  harness: TestAppHarness,
  type: HostDaemonCommand["type"],
  threadId: string,
): HostDaemonCommand[] {
  return harness.db
    .select({ payload: hostDaemonCommands.payload })
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.type, type),
        sql`json_extract(${hostDaemonCommands.payload}, '$.threadId') = ${threadId}`,
      ),
    )
    .all()
    .map((row) => hostDaemonCommandSchema.parse(JSON.parse(row.payload)));
}

export function listQueuedEnvironmentCommands(
  harness: TestAppHarness,
  type: HostDaemonCommand["type"],
  environmentId: string,
): HostDaemonCommand[] {
  return harness.db
    .select({ payload: hostDaemonCommands.payload })
    .from(hostDaemonCommands)
    .where(
      and(
        eq(hostDaemonCommands.type, type),
        sql`json_extract(${hostDaemonCommands.payload}, '$.environmentId') = ${environmentId}`,
      ),
    )
    .all()
    .map((row) => hostDaemonCommandSchema.parse(JSON.parse(row.payload)));
}

const TEST_PRODUCER_EVENT_ID_PREFIX = "hdevt_";
const TEST_PRODUCER_EVENT_ID_SUFFIX_LENGTH = 20;
const pendingHostRpcRequests: QueuedCommand[] = [];
const testRpcCursorByHost = new Map<string, number>();

interface RegisterTestHostRpcCaptureArgs {
  hostId: string;
  sessionId: string;
}

interface TestHostRpcSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export interface CreateTestProducerEventIdArgs {
  value: number;
}

export interface CreateTestDaemonEventEnvelopeArgs {
  event: ThreadEvent;
  producerEventIdValue: number;
  threadId?: string;
}

export function createTestProducerEventId(
  args: CreateTestProducerEventIdArgs,
): HostDaemonProducerEventId {
  if (!Number.isSafeInteger(args.value) || args.value < 0) {
    throw new Error(
      "Producer event id number must be a safe non-negative integer",
    );
  }

  let value = args.value;
  let suffix = "";
  for (
    let index = 0;
    index < TEST_PRODUCER_EVENT_ID_SUFFIX_LENGTH;
    index += 1
  ) {
    const alphabetIndex = value % CLIENT_TURN_REQUEST_ID_ALPHABET.length;
    suffix = CLIENT_TURN_REQUEST_ID_ALPHABET.charAt(alphabetIndex) + suffix;
    value = Math.floor(value / CLIENT_TURN_REQUEST_ID_ALPHABET.length);
  }

  return hostDaemonProducerEventIdSchema.parse(
    `${TEST_PRODUCER_EVENT_ID_PREFIX}${suffix}`,
  );
}

export function createTestDaemonEventEnvelope(
  args: CreateTestDaemonEventEnvelopeArgs,
): HostDaemonEventEnvelope {
  return {
    producerEventId: createTestProducerEventId({
      value: args.producerEventIdValue,
    }),
    threadId: args.threadId ?? args.event.threadId,
    event: args.event,
  };
}

export function internalAuthHeaders(
  harness: TestAppHarness,
  args: { hostId?: string; hostType?: HostType } = {},
): HeadersInit {
  const activeSessions = harness.db
    .select({
      hostId: hostDaemonSessions.hostId,
      hostType: hostDaemonSessions.hostType,
    })
    .from(hostDaemonSessions)
    .where(eq(hostDaemonSessions.status, "active"))
    .all();

  const inferredHost = activeSessions.length === 1 ? activeSessions[0] : null;

  return {
    authorization: `Bearer ${createTestDaemonHostKey({
      hostId: args.hostId ?? inferredHost?.hostId ?? "host-1",
      hostType: args.hostType ?? inferredHost?.hostType ?? "persistent",
    })}`,
    "content-type": "application/json",
  };
}

function nextTestRpcCursor(
  deps: Pick<TestAppHarness, "db">,
  hostId: string,
): number {
  const realMaxCursor = deps.db
    .select({ cursor: hostDaemonCommands.cursor })
    .from(hostDaemonCommands)
    .where(eq(hostDaemonCommands.hostId, hostId))
    .all()
    .reduce((maxCursor, row) => Math.max(maxCursor, row.cursor), 0);
  const previousCursor = Math.max(
    testRpcCursorByHost.get(hostId) ?? 0,
    realMaxCursor,
  );
  const nextCursor = previousCursor + 0.0001;
  testRpcCursorByHost.set(hostId, nextCursor);
  return nextCursor;
}

export function registerTestHostRpcCapture(
  deps: Pick<TestAppHarness, "db" | "hub">,
  args: RegisterTestHostRpcCaptureArgs,
): void {
  testRpcCursorByHost.delete(args.hostId);
  for (let index = pendingHostRpcRequests.length - 1; index >= 0; index -= 1) {
    const queued = pendingHostRpcRequests[index];
    if (queued?.row.hostId === args.hostId) {
      pendingHostRpcRequests.splice(index, 1);
    }
  }
  const socket: TestHostRpcSocket = {
    close() {},
    send(data) {
      const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
      if (message.type !== "host-rpc.request") {
        return;
      }
      const command = hostDaemonOnlineRpcCommandSchema.parse(message.command);
      const now = Date.now();
      const row: HostDaemonCommandRow = {
        id: `rpc-${message.requestId}`,
        hostId: args.hostId,
        sessionId: args.sessionId,
        cursor: nextTestRpcCursor(deps, args.hostId),
        type: command.type,
        payload: JSON.stringify(command),
        state: "pending",
        retryCount: 0,
        resultPayload: null,
        createdAt: now,
        fetchedAt: now,
        completedAt: null,
      };
      pendingHostRpcRequests.push({
        command,
        row,
        rpcRequest: message,
      });
    },
  };
  deps.hub.registerDaemon(args.sessionId, args.hostId, socket);
}

function removePendingHostRpcRequest(requestId: string): void {
  const index = pendingHostRpcRequests.findIndex(
    (queued) => queued.rpcRequest?.requestId === requestId,
  );
  if (index >= 0) {
    pendingHostRpcRequests.splice(index, 1);
  }
}

export async function waitForQueuedCommand(
  harness: TestAppHarness,
  predicate: (queued: QueuedCommand) => boolean,
  timeoutMs = 1_000,
): Promise<QueuedCommand> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const rows = harness.db
      .select()
      .from(hostDaemonCommands)
      .orderBy(desc(hostDaemonCommands.createdAt))
      .all();

    for (const row of rows) {
      const queued = {
        command: hostDaemonCommandSchema.parse(JSON.parse(row.payload)),
        row,
      };
      if (predicate(queued)) {
        return queued;
      }
    }

    for (const queued of pendingHostRpcRequests) {
      if (predicate(queued)) {
        return queued;
      }
    }

    await sleep(10);
  }

  throw new Error("Timed out waiting for queued command");
}

export async function waitForQueuedCommandAfter(
  harness: TestAppHarness,
  afterCursor: number,
  predicate: (queued: QueuedCommand) => boolean,
  timeoutMs = 1_000,
): Promise<QueuedCommand> {
  return waitForQueuedCommand(
    harness,
    (queued) => queued.row.cursor > afterCursor && predicate(queued),
    timeoutMs,
  );
}

export function ensureCommandDelivered(
  harness: TestAppHarness,
  args: EnsureCommandDeliveredArgs,
): string {
  const existingAttempt = getActiveCommandAttemptForCommand(
    harness.db,
    args.commandId,
  );
  if (existingAttempt) {
    return existingAttempt.id;
  }

  const command = getCommand(harness.db, args.commandId);
  if (!command) {
    throw new Error(`Command ${args.commandId} does not exist`);
  }
  if (command.state !== "pending") {
    throw new Error(
      `Command ${args.commandId} is ${command.state} and cannot be delivered`,
    );
  }

  fetchCommands(harness.db, harness.hub, args);
  const fetchedAttempt = getActiveCommandAttemptForCommand(
    harness.db,
    args.commandId,
  );
  if (!fetchedAttempt) {
    throw new Error(`Command ${args.commandId} is missing active attempt`);
  }
  return fetchedAttempt.id;
}

function getCommandResultAttemptId(
  harness: TestAppHarness,
  queued: QueuedCommand,
  sessionId: string,
): string {
  const existingAttempt = getActiveCommandAttemptForCommand(
    harness.db,
    queued.row.id,
  );
  if (existingAttempt) {
    return existingAttempt.id;
  }

  const command = getCommand(harness.db, queued.row.id);
  if (command?.state === "success" || command?.state === "error") {
    return `replay-${queued.row.id}`;
  }

  return ensureCommandDelivered(harness, {
    commandId: queued.row.id,
    hostId: queued.row.hostId,
    sessionId,
  });
}

export async function reportQueuedCommandSuccess<
  TCommand extends QueuedCommandPayload,
>(
  harness: TestAppHarness,
  queued: QueuedCommand<TCommand>,
  result: QueuedCommandResult<TCommand>,
  args: { hostId?: string; hostType?: HostType } = {},
): Promise<Response> {
  if (queued.rpcRequest) {
    const sessionId = queued.row.sessionId;
    if (!sessionId) {
      throw new Error("Queued host RPC is missing sessionId");
    }
    const parsedResult = hostDaemonOnlineRpcResultSchemaByType[
      queued.rpcRequest.command.type
    ].parse(result);
    harness.hub.recordHostOnlineRpcResponse({
      message: {
        type: "host-rpc.response",
        requestId: queued.rpcRequest.requestId,
        commandType: queued.rpcRequest.command.type,
        ok: true,
        result: parsedResult,
      },
      sessionId,
    });
    removePendingHostRpcRequest(queued.rpcRequest.requestId);
    return new Response(null, { status: 200 });
  }

  const sessionId = queued.row.sessionId;
  if (!sessionId) {
    throw new Error("Queued command is missing sessionId");
  }
  const attemptId = getCommandResultAttemptId(harness, queued, sessionId);
  const durableCommand = hostDaemonCommandSchema.parse(queued.command);

  return harness.app.request("/internal/session/command-result", {
    method: "POST",
    headers: internalAuthHeaders(harness, args),
    body: JSON.stringify({
      sessionId,
      attemptId,
      commandId: queued.row.id,
      completedAt: Date.now(),
      type: durableCommand.type,
      ok: true,
      result: hostDaemonCommandResultSchemaByType[durableCommand.type].parse(
        result,
      ),
    }),
  });
}

export async function reportQueuedCommandError(
  harness: TestAppHarness,
  queued: QueuedCommand,
  args: { errorCode: string; errorMessage: string },
  auth: { hostId?: string; hostType?: HostType } = {},
): Promise<Response> {
  if (queued.rpcRequest) {
    const sessionId = queued.row.sessionId;
    if (!sessionId) {
      throw new Error("Queued host RPC is missing sessionId");
    }
    harness.hub.recordHostOnlineRpcResponse({
      message: {
        type: "host-rpc.response",
        requestId: queued.rpcRequest.requestId,
        commandType: queued.rpcRequest.command.type,
        ok: false,
        errorCode: args.errorCode,
        errorMessage: args.errorMessage,
      },
      sessionId,
    });
    removePendingHostRpcRequest(queued.rpcRequest.requestId);
    return new Response(null, { status: 200 });
  }

  const sessionId = queued.row.sessionId;
  if (!sessionId) {
    throw new Error("Queued command is missing sessionId");
  }
  const attemptId = getCommandResultAttemptId(harness, queued, sessionId);

  return harness.app.request("/internal/session/command-result", {
    method: "POST",
    headers: internalAuthHeaders(harness, auth),
    body: JSON.stringify({
      sessionId,
      attemptId,
      commandId: queued.row.id,
      completedAt: Date.now(),
      type: queued.command.type,
      ok: false,
      errorCode: args.errorCode,
      errorMessage: args.errorMessage,
    }),
  });
}
