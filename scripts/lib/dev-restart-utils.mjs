import { homedir } from "node:os";
import { join } from "node:path";

export const DEV_SUPERVISOR_RESTART_ENV = "BB_DEV_SUPERVISOR_RESTART";
export const DEV_SUPERVISOR_RESTART_EXIT_CODE = 75;

const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

export function createTurboBuildCommand(filters) {
  const args = [
    "exec",
    "turbo",
    "run",
    "build",
    "--no-daemon",
    "--no-update-notifier",
    "--ui",
    "stream",
    "--output-logs",
    "errors-only",
  ];

  for (const filter of filters) {
    args.push("--filter", filter);
  }

  return {
    args,
    command: pnpmCommand,
  };
}

export function resolveDevDataDir() {
  return process.env.BB_DATA_DIR ?? join(homedir(), ".bb-dev");
}

export function resolveSupervisorPidPath(serviceName) {
  return join(resolveDevDataDir(), "dev-supervisors", `${serviceName}.pid`);
}
