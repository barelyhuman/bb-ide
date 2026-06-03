import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

interface SourceFile {
  contents: string;
  path: string;
}

const SERVER_SRC_ROOT = fileURLToPath(new URL("../../src/", import.meta.url));
const ENVIRONMENT_OWNER_PUBLIC_PATH =
  "services/environments/environment-lifecycle-owner.ts";
const ENVIRONMENT_OWNER_INTERNAL_PATHS = new Set<string>([
  "services/environments/environment-cleanup-internal.ts",
  "services/environments/environment-provisioning-internal.ts",
]);

function listSourceFiles(root: string): SourceFile[] {
  const files: SourceFile[] = [];

  function visit(directory: string): void {
    for (const name of readdirSync(directory)) {
      const path = join(directory, name);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        visit(path);
        continue;
      }
      if (path.endsWith(".ts")) {
        files.push({
          path,
          contents: readFileSync(path, "utf8"),
        });
      }
    }
  }

  visit(root);
  return files;
}

function relativeSourcePath(path: string): string {
  return relative(SERVER_SRC_ROOT, path).split(sep).join("/");
}

describe("environment lifecycle owner boundary", () => {
  it("keeps raw environment lifecycle DB mutators inside owner internals", () => {
    const imports = listSourceFiles(SERVER_SRC_ROOT)
      .filter((file) =>
        file.contents.includes("@bb/db/internal-environment-lifecycle"),
      )
      .map((file) => relativeSourcePath(file.path))
      .sort();

    expect(imports).toEqual([...ENVIRONMENT_OWNER_INTERNAL_PATHS].sort());
  });

  it("keeps environment owner internals behind the public owner module", () => {
    const nonOwnerImports = listSourceFiles(SERVER_SRC_ROOT)
      .map((file) => ({
        path: relativeSourcePath(file.path),
        contents: file.contents,
      }))
      .filter((file) => file.path !== ENVIRONMENT_OWNER_PUBLIC_PATH)
      .filter((file) => !ENVIRONMENT_OWNER_INTERNAL_PATHS.has(file.path))
      .filter(
        (file) =>
          file.contents.includes("environment-cleanup-internal.js") ||
          file.contents.includes("environment-provisioning-internal.js"),
      )
      .map((file) => file.path)
      .sort();

    expect(nonOwnerImports).toEqual([]);
  });

  it("keeps thread provisioning from importing raw environment mutators", () => {
    const threadProvisioningEnvironmentPath = join(
      SERVER_SRC_ROOT,
      "services/threads/thread-provisioning-environment.ts",
    );
    const contents = readFileSync(threadProvisioningEnvironmentPath, "utf8");

    expect(contents).not.toContain("setEnvironmentStatus");
    expect(contents).not.toContain("upsertEnvironmentOperationRecord");
  });
});
