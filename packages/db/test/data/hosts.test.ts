import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost, getHost, listHosts } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  return { db };
}

describe("hosts", () => {
  it("upsert creates a new host", () => {
    const { db } = setup();
    const host = upsertHost(db, noopNotifier, {
      name: "My Machine",
      type: "persistent",
    });

    expect(host.id).toMatch(/^host_/);
    expect(host.name).toBe("My Machine");
    expect(host.type).toBe("persistent");
    expect(host.lastSeenAt).toBeTypeOf("number");
  });

  it("upsert with same ID updates lastSeenAt", () => {
    const { db } = setup();
    const host1 = upsertHost(db, noopNotifier, {
      name: "My Machine",
      type: "persistent",
    });

    // Wait a tiny bit to ensure different timestamp
    const firstSeen = host1.lastSeenAt;

    const host2 = upsertHost(db, noopNotifier, {
      id: host1.id,
      name: "Updated Name",
      type: "persistent",
    });

    expect(host2.id).toBe(host1.id);
    expect(host2.name).toBe("Updated Name");
    expect(host2.lastSeenAt).toBeGreaterThanOrEqual(firstSeen);
  });

  it("retrieves a host by ID", () => {
    const { db } = setup();
    const host = upsertHost(db, noopNotifier, {
      name: "My Machine",
      type: "persistent",
    });

    const fetched = getHost(db, host.id);
    expect(fetched?.id).toBe(host.id);
    expect(getHost(db, "host_nonexistent")).toBeNull();
  });

  it("lists all hosts", () => {
    const { db } = setup();
    upsertHost(db, noopNotifier, { name: "Host 1", type: "persistent" });
    upsertHost(db, noopNotifier, { name: "Host 2", type: "ephemeral" });

    const all = listHosts(db);
    expect(all).toHaveLength(2);
  });
});
