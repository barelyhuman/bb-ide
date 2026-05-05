import { join } from "node:path";
import {
  readManifestSync,
  readRawProviderRecords,
  readRawProviderRecordsFile,
  readReplayCaptureManifestSync,
} from "@bb/replay-capture/reader";
import { writeFixture } from "@bb/replay-capture/writer";
import { fixtureManifestSchema } from "./fixture-schema.js";
import type {
  ProviderAuditFixtureBundle,
  ProviderAuditManifest,
  ProviderAuditPromoteCaptureToFixtureArgs,
  ProviderAuditPromoteCaptureToFixtureResult,
} from "./types.js";

export interface ReadFixtureManifestArgs {
  manifestPath: string;
}

export interface ReadFixtureBundleArgs {
  corpusId: string;
  fixturePath: string;
  providerId: string;
  taskId: string;
}

export function readFixtureManifest(
  args: ReadFixtureManifestArgs,
): ProviderAuditManifest {
  return readManifestSync({
    manifestPath: args.manifestPath,
    schema: fixtureManifestSchema,
  });
}

export function readFixtureBundle(
  args: ReadFixtureBundleArgs,
): ProviderAuditFixtureBundle {
  const manifestPath = join(args.fixturePath, "manifest.json");
  const rawProviderEventsPath = join(
    args.fixturePath,
    "raw-provider-events.ndjson",
  );
  const manifest = readFixtureManifest({ manifestPath });
  if (
    manifest.corpusId !== args.corpusId ||
    manifest.providerId !== args.providerId
  ) {
    throw new Error(`Fixture manifest does not match path: ${args.fixturePath}`);
  }
  const rawProviderEventRecords = readRawProviderRecordsFile({
    filePath: rawProviderEventsPath,
  });
  if (
    rawProviderEventRecords.length !== manifest.eventCounts.rawProviderEvents
  ) {
    throw new Error(
      `Fixture raw provider event count mismatch: ${args.fixturePath}`,
    );
  }

  return {
    corpusId: args.corpusId,
    providerId: args.providerId,
    taskId: args.taskId,
    fixturePath: args.fixturePath,
    manifestPath,
    manifest,
    rawProviderEventsPath,
    rawProviderEventRecords,
    rawProviderEvents: rawProviderEventRecords.map((record) => record.entry),
  };
}

export async function promoteCaptureToFixture(
  args: ProviderAuditPromoteCaptureToFixtureArgs,
): Promise<ProviderAuditPromoteCaptureToFixtureResult> {
  const baseManifest = readReplayCaptureManifestSync({
    dataDir: args.dataDir,
    captureId: args.captureId,
  });
  const rawProviderEventRecords = readRawProviderRecords({
    dataDir: args.dataDir,
    captureId: args.captureId,
  });
  const manifest = fixtureManifestSchema.parse({
    ...baseManifest,
    source: "corpus-fixture",
    corpusId: args.corpusId,
    scenarioId: args.scenarioId,
    scenarioDescription: args.scenarioDescription,
    model: args.model,
    gitSha: args.gitSha,
    gitResetRef: args.gitResetRef,
    workspacePath: args.workspacePath,
    runtimeWorkspacePath: args.runtimeWorkspacePath,
    envWorkspacePath: args.envWorkspacePath,
    runtimeWorkspaceGitStart: args.runtimeWorkspaceGitStart,
    runtimeWorkspaceGitEnd: args.runtimeWorkspaceGitEnd,
    eventCounts: {
      ...baseManifest.eventCounts,
      rawProviderEvents: rawProviderEventRecords.length,
    },
  });
  await writeFixture({
    destinationDir: args.destinationDir,
    manifest,
    rawProviderEventRecords,
  });

  return {
    destinationDir: args.destinationDir,
    manifest,
  };
}
