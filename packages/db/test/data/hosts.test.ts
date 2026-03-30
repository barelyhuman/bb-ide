import { describe, expect, it, vi } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  deleteHost,
  getHost,
  listHosts,
  updateHost,
  upsertHost,
} from "../../src/data/hosts.js";

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

  it("preserves provider, externalId, and destroyedAt when omitted on update", () => {
    const { db } = setup();
    const host = upsertHost(db, noopNotifier, {
      destroyedAt: 123,
      externalId: "sandbox-existing",
      name: "Sandbox Host",
      provider: "e2b",
      type: "ephemeral",
    });

    const updated = upsertHost(db, noopNotifier, {
      id: host.id,
      name: "Sandbox Host Reconnected",
      type: "ephemeral",
    });

    expect(updated).toMatchObject({
      destroyedAt: 123,
      id: host.id,
      name: "Sandbox Host Reconnected",
      provider: "e2b",
      externalId: "sandbox-existing",
      type: "ephemeral",
    });
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

  it("updates only the provided host fields", () => {
    const { db } = setup();
    const host = upsertHost(db, noopNotifier, {
      externalId: "sandbox-old",
      name: "Sandbox Host",
      provider: "e2b",
      type: "ephemeral",
    });

    const updated = updateHost(db, noopNotifier, host.id, {
      externalId: "sandbox-new",
    });

    expect(updated).toMatchObject({
      id: host.id,
      name: "Sandbox Host",
      provider: "e2b",
      externalId: "sandbox-new",
    });
    expect(updated?.updatedAt).toBeGreaterThanOrEqual(host.updatedAt);
  });

  it("notifies when updateHost mutates host metadata", () => {
    const { db } = setup();
    const notifyHost = vi.fn();
    const notifier = {
      notifyCommand() {},
      notifyEnvironment() {},
      notifyHost,
      notifyProject() {},
      notifySystem() {},
      notifyThread() {},
    };
    const host = upsertHost(db, notifier, {
      externalId: "sandbox-old",
      name: "Sandbox Host",
      provider: "e2b",
      type: "ephemeral",
    });
    notifyHost.mockClear();

    updateHost(db, notifier, host.id, {
      destroyedAt: 456,
    });

    expect(notifyHost).toHaveBeenCalledWith(["host-disconnected"]);
    expect(getHost(db, host.id)).toMatchObject({
      destroyedAt: 456,
      externalId: "sandbox-old",
    });
  });

  it("deletes an existing host row", () => {
    const { db } = setup();
    const notifyHost = vi.fn();
    const notifier = {
      notifyCommand() {},
      notifyEnvironment() {},
      notifyHost,
      notifyProject() {},
      notifySystem() {},
      notifyThread() {},
    };
    const host = upsertHost(db, notifier, {
      name: "Transient Host",
      type: "ephemeral",
    });
    notifyHost.mockClear();

    expect(deleteHost(db, notifier, host.id)).toBe(true);
    expect(getHost(db, host.id)).toBeNull();
    expect(notifyHost).toHaveBeenCalledWith(["host-disconnected"]);
  });
});
