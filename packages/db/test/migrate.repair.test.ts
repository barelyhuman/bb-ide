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

    sqlite.exec("ALTER TABLE threads RENAME TO threads_original");
    sqlite.exec(`
      CREATE TABLE threads (
        id text PRIMARY KEY NOT NULL,
        project_id text NOT NULL,
        title text,
        status text DEFAULT 'created' NOT NULL,
        environment_id text,
        environment_record text,
        merge_base_branch text,
        parent_thread_id text,
        archived_at integer,
        last_read_at integer DEFAULT 0 NOT NULL,
        created_at integer NOT NULL,
        updated_at integer NOT NULL
      )
    `);
    sqlite.exec(`
      INSERT INTO threads (
        id,
        project_id,
        title,
        status,
        environment_id,
        environment_record,
        merge_base_branch,
        parent_thread_id,
        archived_at,
        last_read_at,
        created_at,
        updated_at
      )
      SELECT
        id,
        project_id,
        title,
        status,
        environment_id,
        environment_record,
        merge_base_branch,
        parent_thread_id,
        archived_at,
        last_read_at,
        created_at,
        updated_at
      FROM threads_original
    `);
    sqlite.exec("DROP TABLE threads_original");
    sqlite.exec("ALTER TABLE projects RENAME TO projects_original");
    sqlite.exec(`
      CREATE TABLE projects (
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
      INSERT INTO projects (
        id,
        name,
        root_path,
        project_instructions,
        primary_checkout_thread_id,
        created_at,
        updated_at
      )
      SELECT
        id,
        name,
        root_path,
        project_instructions,
        primary_checkout_thread_id,
        created_at,
        updated_at
      FROM projects_original
    `);
    sqlite.exec("DROP TABLE projects_original");

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
