import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const desktopPackageRoot = process.cwd();

const desktopPackageJsonSchema = z.object({
  version: z.string().min(1),
});

async function readDesktopPackageVersion(): Promise<string> {
  const packageJsonText = await readFile(
    resolve(desktopPackageRoot, "package.json"),
    "utf8",
  );
  return desktopPackageJsonSchema.parse(JSON.parse(packageJsonText)).version;
}

// The desktop bundle has shape requirements electron-builder and the runtime
// rely on but the typechecker can't see: main must be CJS (electron-universal
// builds the entry asar around it), the preload must have the desktop version
// baked in at build time (not read from `process.env` at runtime, which is
// empty in packaged builds), the bb-app bridge must be ESM (it imports
// `bb-app/dist/bb-app.js`), and every entry needs its source map alongside it
// for crash-symbolication in shipped builds. One smoke test asserts all four.
describe("desktop build", () => {
  it("emits package-compatible Electron entries", async () => {
    const desktopVersion = await readDesktopPackageVersion();

    await execFileAsync(process.execPath, ["scripts/build.mjs"], {
      cwd: desktopPackageRoot,
    });

    const mainSource = await readFile(
      resolve(desktopPackageRoot, "dist", "main.js"),
      "utf8",
    );
    const preloadSource = await readFile(
      resolve(desktopPackageRoot, "dist", "preload.cjs"),
      "utf8",
    );
    const bridgeSource = await readFile(
      resolve(desktopPackageRoot, "dist", "bb-app-bridge.mjs"),
      "utf8",
    );

    // main.js must be CJS — no top-level ESM imports — so electron-universal
    // can wrap it in the entry asar.
    expect(mainSource).toContain('"use strict";');
    expect(mainSource).not.toMatch(/^import\s/mu);

    // The preload reads its version at *build* time. In a packaged build the
    // env vars are empty, so any residual `process.env.BB_DESKTOP_VERSION`
    // lookup would surface as "undefined" in the title bar / about dialog.
    expect(preloadSource).toContain(desktopVersion);
    expect(preloadSource).not.toContain("BB_DESKTOP_VERSION");
    expect(preloadSource).not.toContain("getDesktopVersion(process.env");

    // The bridge must stay ESM — it pulls bb-app via the package's ESM entry.
    expect(bridgeSource).toContain('import "bb-app/dist/bb-app.js"');

    // Source maps must ship for every entry so crash reports symbolicate.
    for (const mapPath of [
      "main.js.map",
      "preload.cjs.map",
      "log-viewer-preload.cjs.map",
      "bb-app-bridge.mjs.map",
    ]) {
      await expect(
        access(resolve(desktopPackageRoot, "dist", mapPath)),
      ).resolves.toBeUndefined();
    }
  });
});
