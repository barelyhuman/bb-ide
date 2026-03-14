import { afterEach, describe, expect, it } from "vitest";
import type { DbConnection } from "../src/connection.js";
import { createConnection } from "../src/connection.js";
import { migrate } from "../src/migrate.js";

interface SqliteClient {
  exec(sql: string): unknown;
  close(): void;
  pragma(sql: string): Array<Record<string, unknown>> | unknown;
}

function sqliteClient(db: DbConnection): SqliteClient {
  return (db as unknown as { $client: SqliteClient }).$client;
}

describe("migrate schema repair", () => {
  const openSqliteClients: SqliteClient[] = [];

  afterEach(() => {
    while (openSqliteClients.length > 0) {
      openSqliteClients.pop()?.close();
    }
  });

  it("repairs missing provider and manager columns when the migration journal is stale", () => {
    const db = createConnection(":memory:");
    const sqlite = sqliteClient(db);
    openSqliteClients.push(sqlite);
    migrate(db);

    sqlite.exec(`
      CREATE TABLE threads_legacy (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL,
        title text,
        status text DEFAULT 'created' NOT NULL,
        environment_id text,
        merge_base_branch text,
        parent_thread_id text,
        archived_at integer,
        last_read_at integer DEFAULT 0 NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `);
    sqlite.exec(`
      INSERT INTO threads_legacy
      SELECT
        id,
        project_id,
        title,
        status,
        environment_id,
        merge_base_branch,
        parent_thread_id,
        archived_at,
        last_read_at,
        created_at,
        updated_at
      FROM threads
    `);
    sqlite.exec("DROP TABLE threads");
    sqlite.exec("ALTER TABLE threads_legacy RENAME TO threads");
    sqlite.exec(`
      CREATE TABLE projects_legacy (
        id text PRIMARY KEY NOT NULL,
        name text NOT NULL,
        root_path text NOT NULL,
        project_instructions text,
        primary_checkout_thread_id text,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `);
    sqlite.exec(`
      INSERT INTO projects_legacy
      SELECT
        id,
        name,
        root_path,
        project_instructions,
        primary_checkout_thread_id,
        created_at,
        updated_at
      FROM projects
    `);
    sqlite.exec("DROP TABLE projects");
    sqlite.exec("ALTER TABLE projects_legacy RENAME TO projects");

    migrate(db);

    const threadColumns = sqlite.pragma("table_info(`threads`)");
    const projectColumns = sqlite.pragma("table_info(`projects`)");
    const threadColumnNames = Array.isArray(threadColumns)
      ? threadColumns.map((row) => row.name)
      : [];
    const projectColumnNames = Array.isArray(projectColumns)
      ? projectColumns.map((row) => row.name)
      : [];

    expect(threadColumnNames).toContain("provider_id");
    expect(threadColumnNames).toContain("type");
    expect(projectColumnNames).toContain("primary_manager_thread_id");
  });
});
