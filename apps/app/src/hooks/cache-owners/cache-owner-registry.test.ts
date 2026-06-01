import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
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

interface SourceFileViolation {
  filePath: string;
  line: number;
  text: string;
}

const RAW_CACHE_WRITE_METHODS = new Set([
  "cancelQueries",
  "invalidateQueries",
  "refetchQueries",
  "removeQueries",
  "setQueriesData",
  "setQueryData",
]);

const DISALLOWED_CACHE_IMPORT_SUFFIXES = [
  "/cache-effect-utils",
  "/cache-effects",
  "/cache-invalidation-groups",
  "/mutations/thread-archive-cache",
  "/queries/query-cache",
  "/queries/query-keys",
  "/queries/thread-list-cache-data",
] as const;

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

function getAppSourceRoot(): string {
  return path.resolve(new URL("../../", import.meta.url).pathname);
}

function collectSourceFilePaths(directoryPath: string): string[] {
  const paths: string[] = [];
  for (const entryName of readdirSync(directoryPath)) {
    const entryPath = path.join(directoryPath, entryName);
    const stat = statSync(entryPath);
    if (stat.isDirectory()) {
      paths.push(...collectSourceFilePaths(entryPath));
      continue;
    }
    if (entryPath.endsWith(".ts") || entryPath.endsWith(".tsx")) {
      paths.push(entryPath);
    }
  }
  return paths;
}

function toAppRelativePath(filePath: string): string {
  return path.relative(getAppSourceRoot(), filePath).split(path.sep).join("/");
}

function isTestOrStoryFile(relativePath: string): boolean {
  return (
    relativePath.includes(".test.") ||
    relativePath.includes(".stories.") ||
    relativePath.endsWith(".d.ts")
  );
}

function isCacheOwnerFile(relativePath: string): boolean {
  return relativePath.startsWith("hooks/cache-owners/");
}

function isCacheBoundarySubject(relativePath: string): boolean {
  return (
    relativePath.startsWith("hooks/mutations/") ||
    relativePath === "hooks/realtime-cache-effects.ts" ||
    relativePath === "hooks/realtime-cache-registry.ts" ||
    relativePath.endsWith("ActionsProvider.tsx")
  );
}

function parseSourceFile(filePath: string): ts.SourceFile {
  return ts.createSourceFile(
    toAppRelativePath(filePath),
    readFileSync(filePath, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    filePath.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function violationForNode(
  sourceFile: ts.SourceFile,
  filePath: string,
  node: ts.Node,
  text: string,
): SourceFileViolation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart());
  return {
    filePath: toAppRelativePath(filePath),
    line: position.line + 1,
    text,
  };
}

function collectRawCacheWriteViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  for (const filePath of collectSourceFilePaths(getAppSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    if (isTestOrStoryFile(relativePath) || isCacheOwnerFile(relativePath)) {
      continue;
    }
    const sourceFile = parseSourceFile(filePath);
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        RAW_CACHE_WRITE_METHODS.has(node.expression.name.text)
      ) {
        violations.push(
          violationForNode(
            sourceFile,
            filePath,
            node,
            node.expression.getText(sourceFile),
          ),
        );
      }
      ts.forEachChild(node, visit);
    }
    visit(sourceFile);
  }
  return violations;
}

function collectCacheImportBoundaryViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  for (const filePath of collectSourceFilePaths(getAppSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    if (isTestOrStoryFile(relativePath) || !isCacheBoundarySubject(relativePath)) {
      continue;
    }
    const sourceFile = parseSourceFile(filePath);
    sourceFile.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return;
      }
      const modulePath = node.moduleSpecifier.text;
      if (
        DISALLOWED_CACHE_IMPORT_SUFFIXES.some((suffix) =>
          modulePath.endsWith(suffix),
        )
      ) {
        violations.push(
          violationForNode(sourceFile, filePath, node, modulePath),
        );
      }
    });
  }
  return violations;
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

  it("keeps raw app-domain cache writes inside cache owners", () => {
    expect(collectRawCacheWriteViolations()).toEqual([]);
  });

  it("keeps mutation, realtime, and action-provider files off query-key imports", () => {
    expect(collectCacheImportBoundaryViolations()).toEqual([]);
  });
});
