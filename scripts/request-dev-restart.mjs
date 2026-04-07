import { readFile, rm } from "node:fs/promises";
import {
  createTurboBuildCommand,
  resolveSupervisorPidPath,
} from "./lib/dev-restart-utils.mjs";
import { spawn } from "node:child_process";

const restartTargets = {
  both: {
    filters: ["@bb/server", "@bb/host-daemon"],
    label: "server and host-daemon",
    services: ["server", "host-daemon"],
  },
  "host-daemon": {
    filters: ["@bb/host-daemon"],
    label: "host-daemon",
    services: ["host-daemon"],
  },
  server: {
    filters: ["@bb/server"],
    label: "server",
    services: ["server"],
  },
};

function parseTarget(value) {
  if (value === "both" || value === "host-daemon" || value === "server") {
    return value;
  }

  throw new Error('Expected one of: "both", "server", "host-daemon"');
}

async function readRunningSupervisorPid(serviceName) {
  const pidPath = resolveSupervisorPidPath(serviceName);
  let pidText;

  try {
    pidText = await readFile(pidPath, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error(`No running ${serviceName} dev supervisor found at ${pidPath}`);
    }

    throw error;
  }

  const pid = Number.parseInt(pidText.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) {
    await rm(pidPath, { force: true });
    throw new Error(`Invalid PID file for ${serviceName}: ${pidPath}`);
  }

  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      await rm(pidPath, { force: true });
      throw new Error(`Stale PID file for ${serviceName}: ${pidPath}`);
    }

    throw error;
  }

  return pid;
}

async function runBuild(filters) {
  const buildCommand = createTurboBuildCommand(filters);
  const child = spawn(buildCommand.command, buildCommand.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolvePromise) => {
    child.once("error", () => {
      resolvePromise(1);
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        resolvePromise(1);
        return;
      }

      resolvePromise(code ?? 1);
    });
  });

  return exitCode === 0;
}

async function main() {
  const target = parseTarget(process.argv[2] ?? "both");
  const targetConfig = restartTargets[target];
  const supervisorPids = new Map();

  for (const serviceName of targetConfig.services) {
    supervisorPids.set(serviceName, await readRunningSupervisorPid(serviceName));
  }

  process.stdout.write(`[dev] Building ${targetConfig.label} before restart.\n`);
  const buildSucceeded = await runBuild(targetConfig.filters);
  if (!buildSucceeded) {
    process.exitCode = 1;
    return;
  }

  for (const [serviceName, pid] of supervisorPids) {
    process.kill(pid, "SIGUSR1");
    process.stdout.write(`[dev] Requested ${serviceName} restart.\n`);
  }
}

void main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
