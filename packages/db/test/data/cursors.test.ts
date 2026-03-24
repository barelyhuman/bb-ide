import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import { getCursor, setCursor } from "../../src/data/cursors.js";
import { upsertHost } from "../../src/data/hosts.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  return { db, host };
}

describe("cursors", () => {
  it("returns 0 when no cursor exists", () => {
    const { db, host } = setup();
    expect(getCursor(db, noopNotifier, host.id)).toBe(0);
  });

  it("sets and gets cursor", () => {
    const { db, host } = setup();
    setCursor(db, noopNotifier, host.id, 42);
    expect(getCursor(db, noopNotifier, host.id)).toBe(42);
  });

  it("updates existing cursor", () => {
    const { db, host } = setup();
    setCursor(db, noopNotifier, host.id, 10);
    setCursor(db, noopNotifier, host.id, 20);
    expect(getCursor(db, noopNotifier, host.id)).toBe(20);
  });

  it("tracks cursors independently per host", () => {
    const { db, host } = setup();
    const host2 = upsertHost(db, noopNotifier, {
      name: "test-host-2",
      type: "persistent",
    });

    setCursor(db, noopNotifier, host.id, 10);
    setCursor(db, noopNotifier, host2.id, 20);

    expect(getCursor(db, noopNotifier, host.id)).toBe(10);
    expect(getCursor(db, noopNotifier, host2.id)).toBe(20);
  });
});
