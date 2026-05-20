import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createConnection,
  migrate,
  type DbConnection,
  type MigrationWarningLogger,
} from "../src/index.js";

type InsertMigrationParameters = [string, number];
type TableNameParameters = [string];
type QueuedMessageMigrationInsertParameters = [string, string, number, number];

interface IndexNameRow {
  name: string;
}

interface MigrationCreatedAtRow {
  createdAt: number;
}

interface MigratedQueuedMessageRow {
  id: string;
  sortKey: string;
  threadId: string;
}

interface ReadIndexNamesArgs {
  db: DbConnection;
  tableName: string;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const baselineWhen = 1778891867195;
const publishedTerminalSessionUserInputWhen = 1779139400000;
const closedSessionPruneIndexesWhen = 1779139400001;
const threadDynamicContextFileStatesWhen = 1779139400002;
const queuedMessageSortKeyWhen = 1779230683658;
const queuedMessageSortKeyMigrationPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "0004_wild_justice.sql",
);

function closeConnection(db: DbConnection): void {
  db.$client.close();
}

function readIndexNames(args: ReadIndexNamesArgs): string[] {
  return args.db.$client
    .prepare<TableNameParameters, IndexNameRow>(
      `
        SELECT name
        FROM sqlite_master
        WHERE type = 'index'
          AND tbl_name = ?
        ORDER BY name
      `,
    )
    .all(args.tableName)
    .map((row) => row.name);
}

function runQueuedMessageSortKeyMigration(db: DbConnection): void {
  const migrationSql = readFileSync(queuedMessageSortKeyMigrationPath, "utf-8");
  const statements = migrationSql
    .split("--> statement-breakpoint")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);

  for (const statement of statements) {
    db.$client.exec(statement);
  }
}

describe("migrate", () => {
  it("warns when applied migration timestamps are in the future", () => {
    vi.useFakeTimers();
    vi.setSystemTime(queuedMessageSortKeyWhen + 10_000);

    const db = createConnection(":memory:");
    const logger = {
      warn: vi.fn(),
    } satisfies MigrationWarningLogger;

    try {
      migrate(db, { logger });
      expect(logger.warn).not.toHaveBeenCalled();

      const futureCreatedAt = Date.now() + 60_000;
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("future-migration-hash", futureCreatedAt);

      migrate(db, { logger });

      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        {
          migrations: [
            {
              createdAt: futureCreatedAt,
              hash: "future-migration-hash",
            },
          ],
          now: expect.any(Number),
        },
        "Applied database migrations have future timestamps",
      );
    } finally {
      closeConnection(db);
      vi.useRealTimers();
    }
  });

  it("applies 0002 after a database already applied main's 0001 timestamp", () => {
    const db = createConnection(":memory:");

    try {
      migrate(db);

      db.$client.prepare("DROP INDEX host_daemon_commands_session_idx").run();
      db.$client
        .prepare("DROP INDEX host_daemon_sessions_closed_prune_idx")
        .run();
      db.$client
        .prepare("DROP INDEX thread_dynamic_context_file_states_thread_file_idx")
        .run();
      db.$client.prepare("DROP TABLE thread_dynamic_context_file_states").run();
      db.$client.prepare("DELETE FROM __drizzle_migrations").run();
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("baseline-hash", baselineWhen);
      db.$client
        .prepare<InsertMigrationParameters>(
          `
            INSERT INTO __drizzle_migrations (hash, created_at)
            VALUES (?, ?)
          `,
        )
        .run("main-0001-hash", publishedTerminalSessionUserInputWhen);

      expect(
        readIndexNames({ db, tableName: "host_daemon_commands" }),
      ).not.toContain("host_daemon_commands_session_idx");
      expect(
        readIndexNames({ db, tableName: "host_daemon_sessions" }),
      ).not.toContain("host_daemon_sessions_closed_prune_idx");

      migrate(db);

      expect(
        readIndexNames({ db, tableName: "host_daemon_commands" }),
      ).toContain("host_daemon_commands_session_idx");
      expect(
        readIndexNames({ db, tableName: "host_daemon_sessions" }),
      ).toContain("host_daemon_sessions_closed_prune_idx");

      const migrationCreatedAts = db.$client
        .prepare<[], MigrationCreatedAtRow>(
          `
            SELECT created_at AS createdAt
            FROM __drizzle_migrations
            ORDER BY created_at
          `,
        )
        .all()
        .map((row) => row.createdAt);
      expect(migrationCreatedAts).toContain(closedSessionPruneIndexesWhen);
      expect(migrationCreatedAts).toContain(
        threadDynamicContextFileStatesWhen,
      );
    } finally {
      closeConnection(db);
    }
  });

  it("backfills queued message sort keys in existing created order", () => {
    const db = createConnection(":memory:");

    try {
      db.$client.exec(`
        CREATE TABLE threads (
          id text PRIMARY KEY NOT NULL
        );
        CREATE TABLE queued_thread_messages (
          id text PRIMARY KEY NOT NULL,
          thread_id text NOT NULL,
          content text NOT NULL,
          model text NOT NULL,
          reasoning_level text NOT NULL,
          permission_mode text NOT NULL,
          service_tier text NOT NULL,
          claimed_at integer,
          claim_token text,
          created_at integer NOT NULL,
          updated_at integer NOT NULL,
          FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE cascade
        );
      `);
      db.$client
        .prepare("INSERT INTO threads (id) VALUES (?), (?)")
        .run("thr_a", "thr_b");
      const insertQueuedMessage =
        db.$client.prepare<QueuedMessageMigrationInsertParameters>(
          `
          INSERT INTO queued_thread_messages (
            id,
            thread_id,
            content,
            model,
            reasoning_level,
            permission_mode,
            service_tier,
            created_at,
            updated_at
          )
          VALUES (?, ?, '[]', 'gpt-5', 'medium', 'full', 'default', ?, ?)
        `,
        );
      insertQueuedMessage.run("qmsg_b", "thr_a", 1_000, 1_000);
      insertQueuedMessage.run("qmsg_a", "thr_a", 1_000, 1_000);
      insertQueuedMessage.run("qmsg_c", "thr_a", 2_000, 2_000);
      insertQueuedMessage.run("qmsg_other", "thr_b", 500, 500);

      runQueuedMessageSortKeyMigration(db);

      expect(
        db.$client
          .prepare<[], MigratedQueuedMessageRow>(
            `
              SELECT id, thread_id AS threadId, sort_key AS sortKey
              FROM queued_thread_messages
              ORDER BY thread_id, sort_key
            `,
          )
          .all(),
      ).toEqual([
        { id: "qmsg_a", threadId: "thr_a", sortKey: "0000000000000001" },
        { id: "qmsg_b", threadId: "thr_a", sortKey: "0000000000000002" },
        { id: "qmsg_c", threadId: "thr_a", sortKey: "0000000000000003" },
        {
          id: "qmsg_other",
          threadId: "thr_b",
          sortKey: "0000000000000001",
        },
      ]);
    } finally {
      closeConnection(db);
    }
  });
});
