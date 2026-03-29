import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { promisify } from "node:util";
import { bundleTargets } from "./bundle-manifest.mjs";

const execFileAsync = promisify(execFile);

async function main() {
  let totalBytes = 0;

  for (const target of bundleTargets) {
    await execFileAsync("node", ["--check", target.outfile]);
    const bundleStats = await stat(target.outfile);
    totalBytes += bundleStats.size;
    console.log(`${target.label}: syntax ok (${bundleStats.size} bytes)`);
  }

  console.log(`total bundle size: ${totalBytes} bytes`);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
