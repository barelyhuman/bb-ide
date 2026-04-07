import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runDevSupervisor } from "../../../scripts/lib/run-dev-supervisor.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDir, "..");
const repoRoot = resolve(packageRoot, "..", "..");

void runDevSupervisor({
  buildCwd: repoRoot,
  buildFilters: ["@bb/host-daemon"],
  childArgs: ["../../scripts/run-host-daemon.mjs", "--mode", "dev", "--auto-join"],
  childCommand: process.execPath,
  childCwd: packageRoot,
  serviceName: "host-daemon",
}).catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
