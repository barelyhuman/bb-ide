import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REPLAY_CAPTURE_SCHEMA_VERSION,
  createReplayCaptureId,
  type ReplayCaptureManifest,
  type ReplayRawProviderEventRecord,
} from "@bb/replay-capture";
import {
  deriveReplayCaptureUserInputPreview,
  writeFixture,
} from "@bb/replay-capture/writer";
import {
  promoteCaptureToFixture,
  readFixtureBundle,
} from "../src/fixture-bundle.js";

function createTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeJson(path: string, value: object): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

interface LiveReplayManifestArgs {
  captureId: string;
  rawProviderEventCount: number;
}

interface WriteLiveReplayCaptureArgs {
  captureId: string;
  dataDir: string;
  manifestRawProviderEventCount: number;
  rawProviderEventRecords: ReplayRawProviderEventRecord[];
}

interface PromoteTestCaptureArgs {
  captureId: string;
  dataDir: string;
  destinationDir: string;
}

function liveReplayManifest(args: LiveReplayManifestArgs): ReplayCaptureManifest {
  const userInput: ReplayCaptureManifest["turns"][number]["userInput"] = [
    { type: "text", text: "Promote this capture" },
  ];
  return {
    schemaVersion: REPLAY_CAPTURE_SCHEMA_VERSION,
    captureId: args.captureId,
    capturedAt: 1000,
    completedAt: 1200,
    source: "live-dev-capture",
    providerId: "codex",
    projectId: "project-1",
    environmentId: "environment-1",
    threadId: "thread-1",
    providerThreadId: null,
    title: "Live capture",
    kind: "thread-start",
    turns: [
      {
        turnId: "turn-1",
        userInput,
        createdAt: 1000,
      },
    ],
    userInputPreview: deriveReplayCaptureUserInputPreview(userInput),
    execution: {
      model: "gpt-test",
      serviceTier: "fast",
      reasoningLevel: "medium",
      permissionMode: "full",
      source: "client/turn/requested",
    },
    eventCounts: {
      rawProviderEvents: args.rawProviderEventCount,
      droppedRecords: 0,
    },
    errorMessage: null,
  };
}

function rawProviderEventRecord(
  ordinal: number,
): ReplayRawProviderEventRecord {
  return {
    ordinal,
    relativeMs: 10,
    entry: {
      kind: "raw-provider-event",
      captureId: `raw-${ordinal}`,
      capturedAt: 1010,
      providerId: "codex",
      rawLine: "{\"method\":\"turn/completed\"}",
      rawEvent: {
        jsonrpc: "2.0",
        method: "turn/completed",
      },
    },
  };
}

async function writeLiveReplayCapture(
  args: WriteLiveReplayCaptureArgs,
): Promise<void> {
  await writeFixture({
    destinationDir: join(args.dataDir, "replays", args.captureId),
    manifest: liveReplayManifest({
      captureId: args.captureId,
      rawProviderEventCount: args.manifestRawProviderEventCount,
    }),
    rawProviderEventRecords: args.rawProviderEventRecords,
  });
}

async function promoteTestCapture(args: PromoteTestCaptureArgs): Promise<void> {
  await promoteCaptureToFixture({
    dataDir: args.dataDir,
    captureId: args.captureId,
    destinationDir: args.destinationDir,
    corpusId: "corpus",
    scenarioId: "task",
    scenarioDescription: "Promoted task",
    model: "gpt-test",
    gitSha: null,
    gitResetRef: null,
    workspacePath: "$WORKSPACE",
    runtimeWorkspacePath: "$WORKSPACE",
    envWorkspacePath: "$WORKSPACE",
    runtimeWorkspaceGitStart: null,
    runtimeWorkspaceGitEnd: null,
  });
}

describe("fixture bundles", () => {
  it("promotes a v3 live capture to a corpus fixture", async () => {
    const dataDir = createTempDir("provider-audit-replays-");
    const fixtureRoot = createTempDir("provider-audit-fixtures-");
    const captureId = createReplayCaptureId(1000, "aaaaaaaa");
    await writeLiveReplayCapture({
      captureId,
      dataDir,
      manifestRawProviderEventCount: 1,
      rawProviderEventRecords: [rawProviderEventRecord(1)],
    });

    const destinationDir = join(fixtureRoot, "corpus", "codex", "task");
    await promoteTestCapture({ dataDir, captureId, destinationDir });

    const bundle = readFixtureBundle({
      corpusId: "corpus",
      providerId: "codex",
      taskId: "task",
      fixturePath: destinationDir,
    });

    expect(bundle.manifest.source).toBe("corpus-fixture");
    expect(bundle.manifest.captureId).toBe(captureId);
    expect(bundle.manifest.scenarioDescription).toBe("Promoted task");
    expect(bundle.rawProviderEventRecords).toHaveLength(1);
  });

  it("sets promoted fixture raw event counts from the records written", async () => {
    const dataDir = createTempDir("provider-audit-replays-");
    const fixtureRoot = createTempDir("provider-audit-fixtures-");
    const captureId = createReplayCaptureId(1000, "bbbbbbbb");
    await writeLiveReplayCapture({
      captureId,
      dataDir,
      manifestRawProviderEventCount: 99,
      rawProviderEventRecords: [rawProviderEventRecord(1)],
    });

    const destinationDir = join(fixtureRoot, "corpus", "codex", "task");
    await promoteTestCapture({ dataDir, captureId, destinationDir });

    const bundle = readFixtureBundle({
      corpusId: "corpus",
      providerId: "codex",
      taskId: "task",
      fixturePath: destinationDir,
    });
    expect(bundle.manifest.eventCounts.rawProviderEvents).toBe(1);
    expect(bundle.rawProviderEventRecords).toHaveLength(1);
  });

  it("rejects canonical fixtures whose manifest raw count does not match NDJSON", async () => {
    const dataDir = createTempDir("provider-audit-replays-");
    const fixtureRoot = createTempDir("provider-audit-fixtures-");
    const captureId = createReplayCaptureId(1000, "cccccccc");
    await writeLiveReplayCapture({
      captureId,
      dataDir,
      manifestRawProviderEventCount: 1,
      rawProviderEventRecords: [rawProviderEventRecord(1)],
    });

    const destinationDir = join(fixtureRoot, "corpus", "codex", "task");
    await promoteTestCapture({ dataDir, captureId, destinationDir });
    const manifestPath = join(destinationDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    writeJson(manifestPath, {
      ...manifest,
      eventCounts: {
        ...manifest.eventCounts,
        rawProviderEvents: 99,
      },
    });

    expect(() =>
      readFixtureBundle({
        corpusId: "corpus",
        providerId: "codex",
        taskId: "task",
        fixturePath: destinationDir,
      }),
    ).toThrow("Fixture raw provider event count mismatch");
  });
});
