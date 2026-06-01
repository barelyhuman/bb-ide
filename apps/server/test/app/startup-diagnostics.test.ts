import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDir = dirname(fileURLToPath(import.meta.url));

async function readServerEntrypoint(): Promise<string> {
  return readFile(resolve(testDir, "../../src/index.ts"), "utf8");
}

async function readServerPackageJson(): Promise<string> {
  return readFile(resolve(testDir, "../../package.json"), "utf8");
}

describe("server startup diagnostics", () => {
  it("installs safe diagnostics before loading the startup module", async () => {
    const source = await readServerEntrypoint();
    const installCallIndex = source.indexOf("installSafeProcessDiagnostics({");
    const startupImportIndex = source.indexOf('import("./start-server.js")');

    expect(installCallIndex).toBeGreaterThanOrEqual(0);
    expect(startupImportIndex).toBeGreaterThan(installCallIndex);
    expect(source).not.toContain('from "./db.js"');
    expect(source).not.toContain('from "./server.js"');
    expect(source).not.toContain("process.report");
  });

  it("keeps the startup bundle external to the production bootstrap", async () => {
    const packageJson = await readServerPackageJson();

    expect(packageJson).toContain("--external ./start-server.js");
    expect(packageJson).toContain("src/start-server.ts dist/start-server.js");
  });
});
