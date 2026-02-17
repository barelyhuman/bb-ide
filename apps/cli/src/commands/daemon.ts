import { Command } from "commander";
import { spawn } from "node:child_process";
import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SystemStatus } from "@beanbag/core";
import { createClient, unwrap } from "../client.js";

const BEANBAG_DIR = join(homedir(), ".beanbag");
const PID_FILE = join(BEANBAG_DIR, "daemon.pid");

async function writePid(pid: number): Promise<void> {
  await mkdir(BEANBAG_DIR, { recursive: true });
  await writeFile(PID_FILE, String(pid), "utf-8");
}

async function readPid(): Promise<number | null> {
  try {
    const content = await readFile(PID_FILE, "utf-8");
    const pid = parseInt(content.trim(), 10);
    return isNaN(pid) ? null : pid;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function registerDaemonCommands(program: Command, getUrl: () => string): void {
  const daemon = program.command("daemon").description("Manage the beanbag daemon");
  const daemonPackagePath = resolve(
    import.meta.dirname,
    "..",
    "..",
    "..",
    "daemon",
  );

  daemon
    .command("start")
    .description("Start the daemon in the background")
    .action(async () => {
      // Check if already running
      const existingPid = await readPid();
      if (existingPid && isProcessRunning(existingPid)) {
        console.log(`Daemon already running (PID ${existingPid})`);
        return;
      }

      const daemonDistEntryPath = resolve(daemonPackagePath, "dist", "index.js");
      const daemonSourceEntryPath = resolve(daemonPackagePath, "src", "index.ts");
      const daemonTsxRunnerPath = resolve(
        daemonPackagePath,
        "node_modules",
        ".bin",
        "tsx",
      );
      const useBuiltDaemon = existsSync(daemonDistEntryPath);
      const daemonCommand = useBuiltDaemon ? process.execPath : daemonTsxRunnerPath;
      const daemonArgs = useBuiltDaemon
        ? [daemonDistEntryPath]
        : [daemonSourceEntryPath];

      if (!useBuiltDaemon && !existsSync(daemonSourceEntryPath)) {
        console.error(`Daemon source not found at ${daemonSourceEntryPath}`);
        console.error("Build daemon for production: pnpm build");
        process.exit(1);
      }

      if (!useBuiltDaemon && !existsSync(daemonTsxRunnerPath)) {
        console.error(`Daemon runner not found at ${daemonTsxRunnerPath}`);
        console.error("Install dependencies first: pnpm install");
        process.exit(1);
      }

      const child = spawn(daemonCommand, daemonArgs, {
        cwd: daemonPackagePath,
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
      });

      child.unref();

      if (child.pid) {
        await writePid(child.pid);
        console.log(`Daemon started (PID ${child.pid})`);
      } else {
        console.error("Failed to start daemon");
        process.exit(1);
      }
    });

  daemon
    .command("stop")
    .description("Stop the running daemon")
    .action(async () => {
      const pid = await readPid();
      if (!pid) {
        console.log("No daemon PID file found");
        return;
      }

      if (!isProcessRunning(pid)) {
        console.log("Daemon is not running (stale PID file)");
        await unlink(PID_FILE).catch(() => {});
        return;
      }

      try {
        process.kill(pid, "SIGTERM");
        console.log(`Daemon stopped (PID ${pid})`);
        await unlink(PID_FILE).catch(() => {});
      } catch (err) {
        console.error(`Failed to stop daemon: ${err}`);
        process.exit(1);
      }
    });

  daemon
    .command("status")
    .description("Show daemon status")
    .action(async () => {
      const client = createClient(getUrl());
      try {
        const status = await unwrap<SystemStatus>(
          client.api.v1.system.status.$get(),
        );
        console.log("Daemon is running");
        console.log("");
        console.log(`  Uptime:           ${formatUptime(status.uptime)}`);
        console.log(`  Active threads:   ${status.runningThreads}`);
        console.log(`  Total threads:    ${status.totalThreads}`);
      } catch {
        // Check if process is running by PID
        const pid = await readPid();
        if (pid && isProcessRunning(pid)) {
          console.log(`Daemon process is running (PID ${pid}) but not responding`);
        } else {
          console.log("Daemon is not running");
        }
      }
    });
}

export function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
