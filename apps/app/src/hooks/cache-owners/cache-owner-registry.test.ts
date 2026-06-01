import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  ENVIRONMENT_CHANGE_KINDS,
  HOST_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
  THREAD_CHANGE_KINDS,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { cacheOwnerRegistry } from "./cache-owner-registry";
import { CACHE_OWNER_IDS, type CacheOwnerRealtimeEvent } from "./cache-owner-types";

interface QueryRootExport {
  name: string;
  value: string;
}

interface DuplicateQueryRootOwner {
  owners: string[];
  queryRoot: string;
}

function hasExportModifier(node: ts.VariableStatement): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword,
    ) ?? false
  );
}

function collectExportedQueryRootValues(): QueryRootExport[] {
  const queryKeysUrl = new URL("../queries/query-keys.ts", import.meta.url);
  const sourceText = readFileSync(queryKeysUrl, "utf8");
  const sourceFile = ts.createSourceFile(
    "query-keys.ts",
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const exports: QueryRootExport[] = [];

  sourceFile.forEachChild((node) => {
    if (!ts.isVariableStatement(node) || !hasExportModifier(node)) {
      return;
    }
    for (const declaration of node.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) {
        continue;
      }
      const name = declaration.name.text;
      if (!name.endsWith("_QUERY_KEY")) {
        continue;
      }
      if (
        declaration.initializer === undefined ||
        !ts.isStringLiteral(declaration.initializer)
      ) {
        continue;
      }
      exports.push({ name, value: declaration.initializer.text });
    }
  });

  return exports;
}

function buildRealtimeEventKey(event: CacheOwnerRealtimeEvent): string {
  return `${event.entity}:${event.kind}`;
}

describe("cache owner registry", () => {
  it("assigns every app-domain query root to exactly one owner", () => {
    const exportedQueryRoots = collectExportedQueryRootValues();
    const ownerIdsByQueryRoot = new Map<string, string[]>();

    for (const owner of cacheOwnerRegistry) {
      for (const queryRoot of owner.ownedQueryRoots) {
        const ownerIds = ownerIdsByQueryRoot.get(queryRoot) ?? [];
        ownerIds.push(owner.id);
        ownerIdsByQueryRoot.set(queryRoot, ownerIds);
      }
    }

    const missingOwners = exportedQueryRoots
      .filter(({ value }) => !ownerIdsByQueryRoot.has(value))
      .map(({ name, value }) => `${name}:${value}`);
    const duplicateOwners: DuplicateQueryRootOwner[] = [];
    for (const [queryRoot, owners] of ownerIdsByQueryRoot) {
      if (owners.length > 1) {
        duplicateOwners.push({ owners, queryRoot });
      }
    }

    expect(missingOwners).toEqual([]);
    expect(duplicateOwners).toEqual([]);
  });

  it("declares required ownership policy fields for every owner", () => {
    expect(cacheOwnerRegistry.map((owner) => owner.id)).toEqual(
      Array.from(CACHE_OWNER_IDS),
    );

    for (const owner of cacheOwnerRegistry) {
      expect(owner.ownedQueryRoots.length, owner.id).toBeGreaterThan(0);
      expect(owner.bootstrapPolicy.length, owner.id).toBeGreaterThan(0);
      expect(owner.deletionBehavior.length, owner.id).toBeGreaterThan(0);
      expect(owner.reconnectBehavior.length, owner.id).toBeGreaterThan(0);
    }
  });

  it("covers every realtime change kind with at least one owner", () => {
    const handledEvents = new Set(
      cacheOwnerRegistry.flatMap((owner) =>
        owner.handledRealtimeEvents.map(buildRealtimeEventKey),
      ),
    );
    const expectedEvents = [
      ...THREAD_CHANGE_KINDS.map((kind) => `thread:${kind}`),
      ...PROJECT_CHANGE_KINDS.map((kind) => `project:${kind}`),
      ...ENVIRONMENT_CHANGE_KINDS.map((kind) => `environment:${kind}`),
      ...HOST_CHANGE_KINDS.map((kind) => `host:${kind}`),
      ...SYSTEM_CHANGE_KINDS.map((kind) => `system:${kind}`),
    ];

    expect(
      expectedEvents.filter((event) => !handledEvents.has(event)),
    ).toEqual([]);
  });
});
