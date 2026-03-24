import { Command } from "commander";
import type {
  SystemShutdownAcceptedResponse,
  SystemShutdownBlockedResponse,
  SystemShutdownBlockingThread,
} from "@bb/server-contract";
import { createClient, unwrap } from "../client.js";
import { getErrorMessage, outputJson } from "./helpers.js";

// TODO: SystemHealthReport not in @bb/server-contract — see phase-2a-findings.md
interface SystemHealthReport {
  generatedAt: string;
  uptime: number;
  projectCount: number;
  runningThreads: number;
  threadCounts: {
    total: number;
    archived: number;
    active: number;
    idle: number;
    error: number;
    provisioning: number;
    created: number;
  };
  storage: {
    totalBytes: number;
    disk?: {
      availableBytes: number;
      totalBytes: number;
      path: string;
    };
    buckets: Array<{
      label: string;
      bytes: number;
      paths: string[];
    }>;
  };
}


function formatBlockingThread(thread: SystemShutdownBlockingThread): string {
  return `- ${thread.id} (${thread.status}, project ${thread.projectId})`;
}

function formatBytes(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const digits = unitIndex === 0 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(digits)} ${units[unitIndex]}`;
}

function formatUptime(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return `${hours}h ${minutes}m ${remainingSeconds}s`;
}

function printHealthReport(report: SystemHealthReport): void {
  console.log("Server Health");
  console.log(`Generated: ${new Date(report.generatedAt).toISOString()}`);
  console.log(`Uptime: ${formatUptime(report.uptime)}`);
  console.log(`Projects: ${report.projectCount}`);
  console.log(`Running threads: ${report.runningThreads}`);
  console.log(
    "Threads: " +
      `${report.threadCounts.total} total, ` +
      `${report.threadCounts.archived} archived, ` +
      `${report.threadCounts.active} active, ` +
      `${report.threadCounts.idle} idle, ` +
      `${report.threadCounts.error} error, ` +
      `${report.threadCounts.provisioning} provisioning, ` +
      `${report.threadCounts.created} created`,
  );
  console.log(`Managed storage: ${formatBytes(report.storage.totalBytes)}`);
  if (report.storage.disk) {
    console.log(
      `Disk: ${formatBytes(report.storage.disk.availableBytes)} free / ${formatBytes(report.storage.disk.totalBytes)} total at ${report.storage.disk.path}`,
    );
  }
  console.log("Storage buckets:");
  for (const bucket of report.storage.buckets) {
    console.log(`- ${bucket.label}: ${formatBytes(bucket.bytes)}`);
    for (const path of bucket.paths) {
      console.log(`  ${path}`);
    }
  }
}

export function registerServerCommands(program: Command, getUrl: () => string): void {
  const server = program.command("server").description("Manage server lifecycle");

  server
    .command("health")
    .description("Show server health and managed storage usage")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: { json?: boolean }) => {
      try {
        // TODO: /system/health route not in @bb/server-contract. See phase-2a-findings.md.
        // Using a manual fetch as a fallback until the contract is updated.
        const report = await unwrap<SystemHealthReport>(
          fetch(`${getUrl()}/api/v1/system/health`),
        );
        if (outputJson(opts, report)) return;
        printHealthReport(report);
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });

  server
    .command("restart")
    .description("Safely request server shutdown before restart")
    .option("--force", "Shutdown even when active/provisioning work exists")
    .option("--json", "Print machine-readable JSON output")
    .action(async (opts: { force?: boolean; json?: boolean }) => {
      const client = createClient(getUrl());
      try {
        const shutdownResponse = await client.api.v1.system.shutdown.$post({
          json: opts.force ? { force: true } : {},
        });

        if (shutdownResponse.status === 409) {
          const blocked = await shutdownResponse.json() as SystemShutdownBlockedResponse;
          const blockingThreads = blocked.blockingThreads ?? [];
          console.error(
            blocked.message ??
              "Server shutdown blocked by active thread work. Use --force to override.",
          );
          if (blockingThreads.length > 0) {
            console.error("Blocking threads:");
            for (const thread of blockingThreads) {
              console.error(formatBlockingThread(thread));
            }
          }
          process.exit(1);
          return;
        }

        const payload = await unwrap<SystemShutdownAcceptedResponse>(
          Promise.resolve(shutdownResponse),
        );
        if (outputJson(opts, payload)) return;
        console.log(
          payload.forced
            ? "Server shutdown requested (forced)."
            : "Server shutdown requested.",
        );
        console.log(
          "Restart server now (for example: `pnpm server` or your configured dev watcher).",
        );
      } catch (err: unknown) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    });
}
