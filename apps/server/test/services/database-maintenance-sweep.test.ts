import { describe, expect, it } from "vitest";
import {
  createConnection,
  createProject,
  createThread,
  getDatabaseCompactionStats,
  getDatabaseMaintenanceActivity,
  isDatabaseMaintenanceIdle,
  migrate,
  noopNotifier,
  upsertHost,
} from "@bb/db";
import { runDatabaseMaintenanceSweep } from "../../src/services/system/periodic-sweeps.js";
import { testLogger } from "../helpers/test-app.js";

const ONE_HOUR_MS = 60 * 60_000;

function setupBusyDatabaseWithFreelist() {
  const db = createConnection(":memory:");
  migrate(db);

  // An active thread keeps the instance "not idle", which historically blocked
  // database maintenance entirely.
  const host = upsertHost(db, noopNotifier, {
    name: "maintenance-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "maintenance-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/project" },
  });
  createThread(db, noopNotifier, {
    projectId: project.id,
    providerId: "codex",
    status: "active",
  });

  // Build a freelist: insert several pages of data, then delete it.
  db.$client.exec(
    "CREATE TABLE scratch_blobs (id INTEGER PRIMARY KEY, blob TEXT)",
  );
  const insert = db.$client.prepare(
    "INSERT INTO scratch_blobs (blob) VALUES (?)",
  );
  const blob = "x".repeat(8 * 1024);
  const insertMany = db.$client.transaction((count: number) => {
    for (let index = 0; index < count; index += 1) {
      insert.run(blob);
    }
  });
  insertMany(3_000);
  db.$client.exec("DELETE FROM scratch_blobs");

  return { db };
}

describe("runDatabaseMaintenanceSweep", () => {
  it("reclaims freed pages incrementally even when the instance is not idle", () => {
    const { db } = setupBusyDatabaseWithFreelist();

    // Precondition: there is reclaimable space and the instance is busy, so the
    // old full-VACUUM path would have skipped maintenance.
    const before = getDatabaseCompactionStats(db);
    expect(before.freelistCount).toBeGreaterThan(0);
    expect(
      isDatabaseMaintenanceIdle(getDatabaseMaintenanceActivity(db)),
    ).toBe(false);

    // `now` far in the future clears the once-per-hour interval gate.
    runDatabaseMaintenanceSweep(
      { db, logger: testLogger },
      Date.now() + 2 * ONE_HOUR_MS,
    );

    expect(getDatabaseCompactionStats(db).freelistCount).toBeLessThan(
      before.freelistCount,
    );
  });
});
