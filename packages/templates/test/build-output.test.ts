import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const packageRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const entrypointDeclarationPath = path.join(packageRoot, "dist", "index.d.ts");

describe("@bb/templates build output", () => {
  it("emits the package entrypoint declaration", () => {
    expect(existsSync(entrypointDeclarationPath)).toBe(true);
    expect(readFileSync(entrypointDeclarationPath, "utf8")).toContain(
      "renderTemplate",
    );
  });
});
