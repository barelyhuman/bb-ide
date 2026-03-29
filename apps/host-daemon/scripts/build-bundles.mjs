import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { build } from "esbuild";
import { bundleTargets } from "./bundle-manifest.mjs";

const NODE_ESM_REQUIRE_BANNER = [
  'import { createRequire as __createRequire } from "node:module";',
  'import { dirname as __pathDirname } from "node:path";',
  'import { fileURLToPath as __fileURLToPath } from "node:url";',
  "const require = __createRequire(import.meta.url);",
  "const __filename = __fileURLToPath(import.meta.url);",
  "const __dirname = __pathDirname(__filename);",
].join("");

async function main() {
  for (const target of bundleTargets) {
    await mkdir(dirname(target.outfile), { recursive: true });
    await build({
      banner: {
        js: NODE_ESM_REQUIRE_BANNER,
      },
      bundle: true,
      entryPoints: [target.entryPoint],
      format: "esm",
      legalComments: "none",
      minify: true,
      outfile: target.outfile,
      platform: "node",
      sourcemap: false,
      target: "node22",
    });
    const bundleStats = await stat(target.outfile);
    console.log(`${target.label}: ${bundleStats.size} bytes`);
  }
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
