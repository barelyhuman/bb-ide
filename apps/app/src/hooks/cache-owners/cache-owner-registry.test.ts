import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

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

const DEPRECATED_CACHE_SHIM_MODULES = new Set([
  "hooks/cache-effect-utils",
  "hooks/cache-effects",
  "hooks/cache-invalidation-groups",
  "hooks/environment-cache-effects",
  "hooks/mutation-cache-effects",
  "hooks/mutations/thread-archive-cache",
  "hooks/queries/query-cache",
  "hooks/queries/thread-list-cache-data",
  "hooks/realtime-cache-registry",
  "hooks/system-cache-effects",
]);

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
    if (
      isTestOrStoryFile(relativePath) ||
      !isCacheBoundarySubject(relativePath)
    ) {
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

function resolveAppImportModulePath(
  relativePath: string,
  modulePath: string,
): string | null {
  if (modulePath.startsWith("@/")) {
    return modulePath.slice(2);
  }
  if (modulePath.startsWith("./") || modulePath.startsWith("../")) {
    return path.posix.normalize(
      path.posix.join(path.posix.dirname(relativePath), modulePath),
    );
  }
  return null;
}

function collectDeprecatedCacheShimImportViolations(): SourceFileViolation[] {
  const violations: SourceFileViolation[] = [];
  for (const filePath of collectSourceFilePaths(getAppSourceRoot())) {
    const relativePath = toAppRelativePath(filePath);
    const sourceFile = parseSourceFile(filePath);
    sourceFile.forEachChild((node) => {
      if (
        !ts.isImportDeclaration(node) ||
        !ts.isStringLiteral(node.moduleSpecifier)
      ) {
        return;
      }
      const resolvedModulePath = resolveAppImportModulePath(
        relativePath,
        node.moduleSpecifier.text,
      );
      if (
        resolvedModulePath &&
        DEPRECATED_CACHE_SHIM_MODULES.has(resolvedModulePath)
      ) {
        violations.push(
          violationForNode(
            sourceFile,
            filePath,
            node,
            node.moduleSpecifier.text,
          ),
        );
      }
    });
  }
  return violations;
}

describe("cache owner boundaries", () => {
  it("keeps raw app-domain cache writes inside cache owners", () => {
    expect(collectRawCacheWriteViolations()).toEqual([]);
  });

  it("keeps mutation, realtime, and action-provider files off query-key imports", () => {
    expect(collectCacheImportBoundaryViolations()).toEqual([]);
  });

  it("keeps imports off deprecated cache-owner re-export shims", () => {
    expect(collectDeprecatedCacheShimImportViolations()).toEqual([]);
  });
});
