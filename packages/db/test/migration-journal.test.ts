import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  publishedMigrationWhens,
  publishedMigrationWhensByTag,
} from "../src/migration-history.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const journalPath = resolve(
  __dirname,
  "..",
  "drizzle",
  "meta",
  "_journal.json",
);
const latestPublishedMigrationWhen = Math.max(
  ...publishedMigrationWhens.map((entry) => entry.when),
);

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

interface Journal {
  entries: JournalEntry[];
}

function readJournal(): Journal {
  return JSON.parse(fs.readFileSync(journalPath, "utf-8")) as Journal;
}

describe("migration journal integrity", () => {
  it("has strictly increasing `when` timestamps", () => {
    const { entries } = readJournal();

    const violations: string[] = [];
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].when <= entries[i - 1].when) {
        violations.push(
          `entries[${i}] ${entries[i].tag} (when=${entries[i].when}) <= ` +
            `entries[${i - 1}] ${entries[i - 1].tag} (when=${entries[i - 1].when})`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("has `idx` values matching array position", () => {
    const { entries } = readJournal();

    const mismatches: string[] = [];
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].idx !== i) {
        mismatches.push(
          `entries[${i}] ${entries[i].tag} has idx=${entries[i].idx}, expected ${i}`,
        );
      }
    }

    expect(mismatches).toEqual([]);
  });

  it("has a matching .sql file for every journal entry", () => {
    const { entries } = readJournal();
    const drizzleDir = resolve(__dirname, "..", "drizzle");

    const missing: string[] = [];
    for (const entry of entries) {
      const sqlPath = resolve(drizzleDir, `${entry.tag}.sql`);
      if (!fs.existsSync(sqlPath)) {
        missing.push(entry.tag);
      }
    }

    expect(missing).toEqual([]);
  });

  it("contains every published migration with its released timestamp", () => {
    const { entries } = readJournal();
    const entriesByTag = new Map(entries.map((entry) => [entry.tag, entry]));

    const violations: string[] = [];
    for (const publishedMigration of publishedMigrationWhens) {
      const entry = entriesByTag.get(publishedMigration.tag);
      if (entry === undefined) {
        violations.push(`${publishedMigration.tag} is missing from journal`);
        continue;
      }

      if (entry.when !== publishedMigration.when) {
        violations.push(
          `${entry.tag} has when=${entry.when}, expected published when=${publishedMigration.when}`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it("keeps new migrations after the published migration history", () => {
    const { entries } = readJournal();

    const violations = entries
      .filter((entry) => !publishedMigrationWhensByTag.has(entry.tag))
      .filter((entry) => entry.when <= latestPublishedMigrationWhen)
      .map(
        (entry) =>
          `${entry.tag} has when=${entry.when}, expected > ${latestPublishedMigrationWhen}`,
      );

    expect(violations).toEqual([]);
  });
});
