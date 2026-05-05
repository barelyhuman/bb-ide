import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import type { AddressInfo, Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import {
  createConnection,
  createProject,
  createThread,
  hostDaemonCommands,
  migrate,
  noopNotifier,
  queueCommand,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  clientTurnRequestIdSchema,
  jsonValueSchema,
  type JsonObject,
} from "@bb/domain";
import { z } from "zod";
import { describe, expect, it } from "vitest";
import {
  EventProtocolHardCutoverPreflightError,
  runEventProtocolHardCutoverIntegrityCheck,
  runEventProtocolHardCutoverMigration,
  runEventProtocolHardCutoverPreflight,
} from "../../src/scripts/event-protocol-hard-cutover-migration.js";
import {
  DEFAULT_LIVE_BACKUP_DIR,
  formatCliUsage,
  isHelpRequested,
  isTcpPortAcceptingConnections,
  runCli,
  runCliWithRuntime,
} from "../../src/scripts/run-event-protocol-hard-cutover-migration.js";

interface TestDatabaseState {
  db: DbConnection;
  hostId: string;
  threadId: string;
}

interface InsertRawEventArgs {
  data: JsonObject;
  id?: string;
  itemId?: string | null;
  itemKind?: string | null;
  providerThreadId?: string | null;
  scopeKind: "thread" | "turn";
  sequence: number;
  threadId: string;
  turnId?: string | null;
  type: string;
}

interface LegacyRequestEventArgs {
  sequence: number;
  threadId: string;
}

interface SeedSuccessfulLegacyStateResult {
  provisionCommandId: string;
  turnSubmitCommandId: string;
}

interface EventLookupArgs {
  sequence: number;
  threadId: string;
}

interface TestTcpServer {
  port: number;
  server: Server;
}

interface SeededOnDiskDbFixture {
  sourcePath: string;
  tempDir: string;
  threadId: string;
}

type SeededOnDiskDbCallback<T> = (fixture: SeededOnDiskDbFixture) => Promise<T>;

interface WithSeededOnDiskDbArgs<T> {
  prefix: string;
  run: SeededOnDiskDbCallback<T>;
}

interface UnexpectedPortProbe {
  probe: () => Promise<boolean>;
  wasCalled: () => boolean;
}

const jsonObjectSchema = z.record(z.string(), jsonValueSchema);
const jsonDataRowSchema = z.object({ data: z.string() });
const producerEventIdRowSchema = z.object({
  producerEventId: z.string().nullable(),
});
const commandPayloadRowSchema = z.object({ payload: z.string() });

function setupDatabase(path = ":memory:"): TestDatabaseState {
  const db = createConnection(path);
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    id: "host-phase5",
    name: "Phase 5 Host",
    type: "persistent",
  });
  const project = createProject(db, noopNotifier, {
    name: "Phase 5 Project",
    source: {
      type: "local_path",
      hostId: host.id,
      path: "/tmp/phase5-project",
    },
  }).project;
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "active",
  });

  return {
    db,
    hostId: host.id,
    threadId: thread.id,
  };
}

function insertRawEvent(db: DbConnection, args: InsertRawEventArgs): void {
  db.run(sql`
    INSERT INTO events (
      id,
      thread_id,
      environment_id,
      scope_kind,
      turn_id,
      provider_thread_id,
      sequence,
      type,
      item_id,
      item_kind,
      data,
      created_at
    )
    VALUES (
      ${args.id ?? `evt_${args.sequence}_${args.type}`},
      ${args.threadId},
      NULL,
      ${args.scopeKind},
      ${args.turnId ?? null},
      ${args.providerThreadId ?? null},
      ${args.sequence},
      ${args.type},
      ${args.itemId ?? null},
      ${args.itemKind ?? null},
      ${JSON.stringify(args.data)},
      ${args.sequence}
    )
  `);
}

function insertLegacyRequestEvent(
  db: DbConnection,
  args: LegacyRequestEventArgs,
): void {
  insertRawEvent(db, {
    threadId: args.threadId,
    sequence: args.sequence,
    type: "client/turn/requested",
    scopeKind: "thread",
    data: {
      direction: "outbound",
      input: [{ type: "text", text: `Request ${args.sequence}` }],
      target: { kind: "new-turn" },
      execution: {
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "full",
        source: "client/turn/requested",
      },
      initiator: "user",
      request: {
        method: "turn/start",
        params: {},
      },
      source: "tell",
    },
  });
}

function seedSuccessfulLegacyState(
  state: TestDatabaseState,
): SeedSuccessfulLegacyStateResult {
  insertLegacyRequestEvent(state.db, {
    threadId: state.threadId,
    sequence: 1,
  });
  insertRawEvent(state.db, {
    threadId: state.threadId,
    sequence: 2,
    type: "turn/input/accepted",
    scopeKind: "turn",
    turnId: "turn-1",
    providerThreadId: "provider-thread-1",
    data: {
      clientRequestSequence: 1,
    },
  });
  insertRawEvent(state.db, {
    threadId: state.threadId,
    sequence: 3,
    type: "item/completed",
    scopeKind: "turn",
    turnId: "turn-1",
    providerThreadId: "provider-thread-1",
    itemId: "user-1",
    itemKind: "userMessage",
    data: {
      item: {
        type: "userMessage",
        id: "user-1",
        content: [{ type: "text", text: "Accepted input" }],
        clientRequestSequence: 1,
      },
    },
  });
  insertRawEvent(state.db, {
    threadId: state.threadId,
    sequence: 4,
    type: "turn/started",
    scopeKind: "turn",
    turnId: "turn-1",
    providerThreadId: "provider-thread-1",
    data: {},
  });

  const turnSubmit = queueCommand(state.db, noopNotifier, {
    hostId: state.hostId,
    type: "turn.submit",
    payload: JSON.stringify({
      type: "turn.submit",
      threadId: state.threadId,
      eventSequence: 1,
    }),
  });
  const provision = queueCommand(state.db, noopNotifier, {
    hostId: state.hostId,
    type: "environment.provision",
    payload: JSON.stringify({
      type: "environment.provision",
      environmentId: "env-phase5",
      initiator: {
        threadId: state.threadId,
        provisioningId: "tprov_phase5",
        eventSequence: 1,
      },
    }),
  });

  return {
    provisionCommandId: provision.id,
    turnSubmitCommandId: turnSubmit.id,
  };
}

function getEventData(db: DbConnection, args: EventLookupArgs): JsonObject {
  const row = db.$client
    .prepare("SELECT data FROM events WHERE thread_id = ? AND sequence = ?")
    .get(args.threadId, args.sequence);
  const parsedRow = jsonDataRowSchema.optional().parse(row);
  if (!parsedRow) {
    throw new Error(`Missing event at sequence ${args.sequence}`);
  }
  return jsonObjectSchema.parse(JSON.parse(parsedRow.data));
}

function getProducerEventId(
  db: DbConnection,
  args: EventLookupArgs,
): string | null {
  const row = db.$client
    .prepare(
      "SELECT producer_event_id AS producerEventId FROM events WHERE thread_id = ? AND sequence = ?",
    )
    .get(args.threadId, args.sequence);
  const parsedRow = producerEventIdRowSchema.optional().parse(row);
  if (!parsedRow) {
    throw new Error(`Missing event at sequence ${args.sequence}`);
  }
  return parsedRow.producerEventId;
}

function getCommandPayload(db: DbConnection, commandId: string): JsonObject {
  const row = db.$client
    .prepare("SELECT payload FROM host_daemon_commands WHERE id = ?")
    .get(commandId);
  const parsedRow = commandPayloadRowSchema.optional().parse(row);
  if (!parsedRow) {
    throw new Error(`Missing command ${commandId}`);
  }
  return jsonObjectSchema.parse(JSON.parse(parsedRow.payload));
}

function isAddressInfo(
  address: AddressInfo | string | null,
): address is AddressInfo {
  return address !== null && typeof address !== "string";
}

function startTcpServer(): Promise<TestTcpServer> {
  const server = createServer();
  return new Promise((resolveStart, rejectStart) => {
    function cleanup(): void {
      server.removeListener("error", rejectStart);
    }

    server.once("error", rejectStart);
    server.listen(0, "127.0.0.1", () => {
      cleanup();
      const address = server.address();
      if (!isAddressInfo(address)) {
        rejectStart(new Error("Expected TCP server to have an address"));
        return;
      }
      resolveStart({ port: address.port, server });
    });
  });
}

function closeTcpServer(server: Server): Promise<void> {
  return new Promise((resolveClose, rejectClose) => {
    server.close((error) => {
      if (error) {
        rejectClose(error);
        return;
      }
      resolveClose();
    });
  });
}

async function withSeededDbOnDisk<T>(
  args: WithSeededOnDiskDbArgs<T>,
): Promise<T> {
  const tempDir = mkdtempSync(join(tmpdir(), args.prefix));
  try {
    const sourcePath = join(tempDir, "source.db");
    const sourceState = setupDatabase(sourcePath);
    try {
      seedSuccessfulLegacyState(sourceState);
    } finally {
      sourceState.db.$client.close();
    }
    return await args.run({
      sourcePath,
      tempDir,
      threadId: sourceState.threadId,
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

function createUnexpectedPortProbe(): UnexpectedPortProbe {
  let called = false;
  return {
    probe: () => {
      called = true;
      return Promise.reject(new Error("Port probe should not run"));
    },
    wasCalled: () => called,
  };
}

describe("event protocol hard-cutover migration", () => {
  it("rewrites legacy request correlation, commands, and producer identities", () => {
    const state = setupDatabase();
    try {
      const commands = seedSuccessfulLegacyState(state);

      const report = runEventProtocolHardCutoverMigration({
        apply: true,
        db: state.db,
      });

      expect(report.mutation).toMatchObject({
        backfilledClientRequestIds: 1,
        backfilledProducerEventIds: 3,
        rewrittenCommands: 2,
        rewrittenTurnInputAcceptedEvents: 1,
        rewrittenUserMessageItems: 1,
      });
      expect(report.integrity?.issueCount).toBe(0);

      const requestData = getEventData(state.db, {
        threadId: state.threadId,
        sequence: 1,
      });
      const requestId = clientTurnRequestIdSchema.parse(requestData.requestId);

      expect(
        getEventData(state.db, {
          threadId: state.threadId,
          sequence: 2,
        }),
      ).toMatchObject({
        clientRequestId: requestId,
      });
      expect(
        getEventData(state.db, {
          threadId: state.threadId,
          sequence: 3,
        }),
      ).toMatchObject({
        item: {
          clientRequestId: requestId,
        },
      });
      expect(
        getCommandPayload(state.db, commands.turnSubmitCommandId),
      ).toMatchObject({
        requestId,
      });
      expect(
        getCommandPayload(state.db, commands.provisionCommandId),
      ).toMatchObject({
        initiator: {
          threadId: state.threadId,
          provisioningId: "tprov_phase5",
        },
      });
      expect(
        getCommandPayload(state.db, commands.turnSubmitCommandId),
      ).not.toHaveProperty("eventSequence");
      expect(
        getCommandPayload(state.db, commands.provisionCommandId).initiator,
      ).not.toHaveProperty("eventSequence");
      expect(
        getProducerEventId(state.db, {
          threadId: state.threadId,
          sequence: 1,
        }),
      ).toBeNull();
      expect(
        getProducerEventId(state.db, {
          threadId: state.threadId,
          sequence: 2,
        }),
      ).toMatch(/^hdevt_[23456789abcdefghijkmnpqrstuvwxyz]{20}$/u);
    } finally {
      state.db.$client.close();
    }
  });

  it("reports orphan legacy event references without mutating", () => {
    const state = setupDatabase();
    try {
      insertRawEvent(state.db, {
        threadId: state.threadId,
        sequence: 1,
        type: "turn/input/accepted",
        scopeKind: "turn",
        turnId: "turn-1",
        providerThreadId: "provider-thread-1",
        data: {
          clientRequestSequence: 99,
        },
      });

      const report = runEventProtocolHardCutoverPreflight(state.db);

      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "orphan-event-client-request-sequence",
            sequence: 99,
            threadId: state.threadId,
          }),
        ]),
      );
      expect(
        getEventData(state.db, {
          threadId: state.threadId,
          sequence: 1,
        }),
      ).toMatchObject({ clientRequestSequence: 99 });
    } finally {
      state.db.$client.close();
    }
  });

  it("reports unsupported nested legacy event fields during preflight", () => {
    const state = setupDatabase();
    try {
      insertRawEvent(state.db, {
        threadId: state.threadId,
        sequence: 1,
        type: "turn/started",
        scopeKind: "turn",
        turnId: "turn-1",
        providerThreadId: "provider-thread-1",
        data: {
          metadata: {
            clientRequestSequence: 1,
          },
        },
      });

      const report = runEventProtocolHardCutoverPreflight(state.db);

      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            fieldPath: "$.metadata.clientRequestSequence",
            kind: "unresolved-legacy-event-field",
            threadId: state.threadId,
          }),
        ]),
      );
    } finally {
      state.db.$client.close();
    }
  });

  it("fails closed before mutation when fetched old-protocol commands remain", () => {
    const state = setupDatabase();
    try {
      insertLegacyRequestEvent(state.db, {
        threadId: state.threadId,
        sequence: 1,
      });
      const command = queueCommand(state.db, noopNotifier, {
        hostId: state.hostId,
        type: "turn.submit",
        payload: JSON.stringify({
          type: "turn.submit",
          threadId: state.threadId,
          eventSequence: 1,
        }),
      });
      state.db
        .update(hostDaemonCommands)
        .set({ state: "fetched", fetchedAt: 123 })
        .where(eq(hostDaemonCommands.id, command.id))
        .run();

      expect(() =>
        runEventProtocolHardCutoverMigration({
          apply: true,
          db: state.db,
        }),
      ).toThrow(EventProtocolHardCutoverPreflightError);
      expect(
        getEventData(state.db, {
          threadId: state.threadId,
          sequence: 1,
        }),
      ).not.toHaveProperty("requestId");
    } finally {
      state.db.$client.close();
    }
  });

  it("strips orphan eventSequence from terminal historical commands", () => {
    const state = setupDatabase();
    try {
      const command = queueCommand(state.db, noopNotifier, {
        hostId: state.hostId,
        type: "thread.start",
        payload: JSON.stringify({
          type: "thread.start",
          threadId: state.threadId,
          eventSequence: 42,
        }),
      });
      state.db
        .update(hostDaemonCommands)
        .set({ state: "success", completedAt: 123 })
        .where(eq(hostDaemonCommands.id, command.id))
        .run();

      const report = runEventProtocolHardCutoverMigration({
        apply: true,
        db: state.db,
      });

      expect(report.mutation).toMatchObject({
        removedTerminalCommandEventSequences: 1,
        rewrittenCommands: 1,
      });
      expect(report.integrity?.issueCount).toBe(0);
      expect(getCommandPayload(state.db, command.id)).toMatchObject({
        threadId: state.threadId,
        type: "thread.start",
      });
      expect(getCommandPayload(state.db, command.id)).not.toHaveProperty(
        "eventSequence",
      );
      expect(getCommandPayload(state.db, command.id)).not.toHaveProperty(
        "requestId",
      );
    } finally {
      state.db.$client.close();
    }
  });

  it("reports duplicate thread sequence rows before mutation", () => {
    const state = setupDatabase();
    try {
      state.db.$client.exec("DROP INDEX events_thread_sequence_idx");
      insertRawEvent(state.db, {
        threadId: state.threadId,
        sequence: 1,
        type: "turn/started",
        scopeKind: "turn",
        turnId: "turn-1",
        providerThreadId: "provider-thread-1",
        data: {},
      });
      insertRawEvent(state.db, {
        threadId: state.threadId,
        sequence: 1,
        type: "turn/completed",
        scopeKind: "turn",
        turnId: "turn-1",
        providerThreadId: "provider-thread-1",
        data: {
          status: "completed",
        },
      });

      const report = runEventProtocolHardCutoverPreflight(state.db);

      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            count: 2,
            kind: "duplicate-event-sequence",
            sequence: 1,
            threadId: state.threadId,
          }),
        ]),
      );
    } finally {
      state.db.$client.close();
    }
  });

  it("tolerates sparse sequence history from pruning", () => {
    const state = setupDatabase();
    try {
      insertLegacyRequestEvent(state.db, {
        threadId: state.threadId,
        sequence: 1,
      });
      insertRawEvent(state.db, {
        threadId: state.threadId,
        sequence: 3,
        type: "turn/started",
        scopeKind: "turn",
        turnId: "turn-1",
        providerThreadId: "provider-thread-1",
        data: {},
      });

      const report = runEventProtocolHardCutoverMigration({
        apply: true,
        db: state.db,
      });

      expect(report.integrity?.issueCount).toBe(0);
      expect(
        getEventData(state.db, {
          threadId: state.threadId,
          sequence: 1,
        }),
      ).toHaveProperty("requestId");
      expect(
        getProducerEventId(state.db, {
          threadId: state.threadId,
          sequence: 3,
        }),
      ).toMatch(/^hdevt_[23456789abcdefghijkmnpqrstuvwxyz]{20}$/u);
    } finally {
      state.db.$client.close();
    }
  });

  it("reports non-positive event sequences before mutation", () => {
    const state = setupDatabase();
    try {
      insertRawEvent(state.db, {
        threadId: state.threadId,
        sequence: 0,
        type: "turn/started",
        scopeKind: "turn",
        turnId: "turn-1",
        providerThreadId: "provider-thread-1",
        data: {},
      });

      const report = runEventProtocolHardCutoverPreflight(state.db);

      expect(report.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: "invalid-event-sequence",
            sequence: 0,
            threadId: state.threadId,
          }),
        ]),
      );
    } finally {
      state.db.$client.close();
    }
  });

  it("runs apply mode on a copied DB without mutating the source DB", async () => {
    await withSeededDbOnDisk({
      prefix: "bb-phase5-migration-",
      run: async ({ sourcePath, tempDir, threadId }) => {
        const copyPath = join(tempDir, "copy.db");

        const report = await runCli([
          "--db",
          sourcePath,
          "--copy-to",
          copyPath,
          "--apply",
        ]);
        expect(report.copiedFrom).toBe(sourcePath);
        expect(report.dbPath).toBe(copyPath);
        expect(report.migration.integrity?.issueCount).toBe(0);

        const source = createConnection(sourcePath);
        const copy = createConnection(copyPath);
        try {
          expect(
            getEventData(source, {
              threadId,
              sequence: 1,
            }),
          ).not.toHaveProperty("requestId");
          expect(
            getEventData(copy, {
              threadId,
              sequence: 1,
            }),
          ).toHaveProperty("requestId");
          expect(
            runEventProtocolHardCutoverIntegrityCheck(copy).issueCount,
          ).toBe(0);
        } finally {
          source.$client.close();
          copy.$client.close();
        }
      },
    });
  });

  it("allows copy-to apply from the live path without consent or port probing", async () => {
    await withSeededDbOnDisk({
      prefix: "bb-phase5-live-copy-",
      run: async ({ sourcePath, tempDir, threadId }) => {
        const copyPath = join(tempDir, "copy.db");
        const backupDir = join(tempDir, "backups");
        const unexpectedProbe = createUnexpectedPortProbe();

        const report = await runCliWithRuntime({
          argv: ["--db", sourcePath, "--copy-to", copyPath, "--apply"],
          runtime: {
            defaultBackupDir: backupDir,
            hostDaemonDevPortAcceptsConnections: unexpectedProbe.probe,
            liveDevDbPath: sourcePath,
          },
        });
        expect(unexpectedProbe.wasCalled()).toBe(false);
        expect(report.copiedFrom).toBe(sourcePath);
        expect(report.dbPath).toBe(copyPath);
        expect(report.migration.integrity?.issueCount).toBe(0);
        expect(existsSync(backupDir)).toBe(false);

        const source = createConnection(sourcePath);
        const copy = createConnection(copyPath);
        try {
          expect(
            getEventData(source, {
              threadId,
              sequence: 1,
            }),
          ).not.toHaveProperty("requestId");
          expect(
            getEventData(copy, {
              threadId,
              sequence: 1,
            }),
          ).toHaveProperty("requestId");
        } finally {
          source.$client.close();
          copy.$client.close();
        }
      },
    });
  });

  it("fails direct live apply before backup or mutation when the daemon port is open", async () => {
    await withSeededDbOnDisk({
      prefix: "bb-phase5-live-gate-",
      run: async ({ sourcePath, tempDir, threadId }) => {
        const backupDir = join(tempDir, "backups");

        await expect(
          runCliWithRuntime({
            argv: [
              "--db",
              sourcePath,
              "--apply",
              "--allow-live-mutation",
              "--confirm-services-stopped",
              "--backup-dir",
              backupDir,
            ],
            runtime: {
              defaultBackupDir: backupDir,
              hostDaemonDevPortAcceptsConnections: () => Promise.resolve(true),
              liveDevDbPath: sourcePath,
            },
          }),
        ).rejects.toThrow("is accepting connections");

        expect(existsSync(backupDir)).toBe(false);

        const source = createConnection(sourcePath);
        try {
          expect(
            getEventData(source, {
              threadId,
              sequence: 1,
            }),
          ).not.toHaveProperty("requestId");
        } finally {
          source.$client.close();
        }
      },
    });
  });

  it("runs direct live apply after consent when the daemon port is closed", async () => {
    await withSeededDbOnDisk({
      prefix: "bb-phase5-live-apply-",
      run: async ({ sourcePath, tempDir, threadId }) => {
        const backupDir = join(tempDir, "backups");

        const report = await runCliWithRuntime({
          argv: [
            "--db",
            sourcePath,
            "--apply",
            "--allow-live-mutation",
            "--confirm-services-stopped",
            "--backup-dir",
            backupDir,
          ],
          runtime: {
            defaultBackupDir: backupDir,
            hostDaemonDevPortAcceptsConnections: () => Promise.resolve(false),
            liveDevDbPath: sourcePath,
          },
        });

        if (report.backupPath === null) {
          throw new Error("Expected direct live apply to create a backup");
        }
        expect(report.copiedFrom).toBeNull();
        expect(report.dbPath).toBe(sourcePath);
        expect(existsSync(report.backupPath)).toBe(true);
        expect(report.migration.integrity?.issueCount).toBe(0);

        const source = createConnection(sourcePath);
        const backup = createConnection(report.backupPath);
        try {
          expect(
            getEventData(source, {
              threadId,
              sequence: 1,
            }),
          ).toHaveProperty("requestId");
          expect(
            getEventData(backup, {
              threadId,
              sequence: 1,
            }),
          ).not.toHaveProperty("requestId");
        } finally {
          source.$client.close();
          backup.$client.close();
        }
      },
    });
  });

  it("requires both live-apply consent flags before probing the daemon port", async () => {
    await withSeededDbOnDisk({
      prefix: "bb-phase5-consent-gate-",
      run: async ({ sourcePath, tempDir }) => {
        const backupDir = join(tempDir, "backups");
        const withoutConfirmProbe = createUnexpectedPortProbe();
        const withoutAllowProbe = createUnexpectedPortProbe();

        await expect(
          runCliWithRuntime({
            argv: ["--db", sourcePath, "--apply", "--allow-live-mutation"],
            runtime: {
              defaultBackupDir: backupDir,
              hostDaemonDevPortAcceptsConnections: withoutConfirmProbe.probe,
              liveDevDbPath: sourcePath,
            },
          }),
        ).rejects.toThrow("Refusing to mutate live ~/.bb-dev/bb.db");
        expect(withoutConfirmProbe.wasCalled()).toBe(false);

        await expect(
          runCliWithRuntime({
            argv: ["--db", sourcePath, "--apply", "--confirm-services-stopped"],
            runtime: {
              defaultBackupDir: backupDir,
              hostDaemonDevPortAcceptsConnections: withoutAllowProbe.probe,
              liveDevDbPath: sourcePath,
            },
          }),
        ).rejects.toThrow("Refusing to mutate live ~/.bb-dev/bb.db");
        expect(withoutAllowProbe.wasCalled()).toBe(false);
        expect(existsSync(backupDir)).toBe(false);
      },
    });
  });

  it("prints CLI help text without requiring a database", () => {
    expect(isHelpRequested(["--help"])).toBe(true);
    expect(isHelpRequested(["-h"])).toBe(true);
    expect(isHelpRequested(["--preflight-only"])).toBe(false);

    const usage = formatCliUsage();

    expect(usage).toContain("--preflight-only");
    expect(usage).toContain(DEFAULT_LIVE_BACKUP_DIR);
    expect(usage).toContain("127.0.0.1:3002");
    expect(usage).toContain("--confirm-services-stopped");
  });

  it("detects accepting TCP ports for direct live-mutation safety", async () => {
    const testServer = await startTcpServer();
    try {
      await expect(
        isTcpPortAcceptingConnections({
          host: "127.0.0.1",
          port: testServer.port,
          timeoutMs: 200,
        }),
      ).resolves.toBe(true);
    } finally {
      await closeTcpServer(testServer.server);
    }

    await expect(
      isTcpPortAcceptingConnections({
        host: "127.0.0.1",
        port: testServer.port,
        timeoutMs: 200,
      }),
    ).resolves.toBe(false);
  });
});
