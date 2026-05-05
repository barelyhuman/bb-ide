import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getReplayCaptureInitialTurn,
  type ReplayCaptureManifest,
} from "@bb/replay-capture";
import { readReplayCaptureManifestSync } from "@bb/replay-capture/reader";
import { promoteCaptureToFixture } from "./fixture-bundle.js";
import type {
  ProviderAuditImportDevReplaysArgs,
  ProviderAuditImportFixtureResult,
  ProviderAuditImportFixturesResult,
} from "./types.js";

const DEFAULT_DEV_REPLAY_CORPUS_ID = "dev-replays";
const DEFAULT_FIXTURE_ROOT = resolve(
  fileURLToPath(new URL("../fixtures", import.meta.url)),
);
const BB_DEV_WORKSPACE_PLACEHOLDER = "$BB_DEV_WORKSPACE";
interface ProviderAuditDevReplayCliParseResult {
  args: ProviderAuditImportDevReplaysArgs;
}

interface ResolveFixtureCorpusRootArgs {
  corpusId: string;
  fixtureRoot: string;
}

interface ProviderAuditImportDevReplayFixtureArgs {
  captureId: string;
  corpusId: string;
  fixtureCorpusRoot: string;
  replayRoot: string;
}

function getHomeDir(): string | null {
  const homeDir = process.env.HOME;
  return homeDir && homeDir.length > 0 ? homeDir : null;
}

function getDefaultDevReplayRoot(): string {
  const homeDir = getHomeDir();
  if (homeDir) {
    return join(homeDir, ".bb-dev", "replays");
  }
  return resolve(".bb-dev", "replays");
}

function resolveFixtureCorpusRoot(args: ResolveFixtureCorpusRootArgs): string {
  if (
    args.corpusId.length === 0 ||
    args.corpusId === "." ||
    args.corpusId === ".." ||
    args.corpusId.includes("/") ||
    args.corpusId.includes("\\")
  ) {
    throw new Error(`Invalid corpus id: ${args.corpusId}`);
  }

  const fixtureRoot = resolve(args.fixtureRoot);
  const candidate = resolve(fixtureRoot, args.corpusId);
  const relativePath = relative(fixtureRoot, candidate);
  const escapesFixtureRoot =
    relativePath === "" ||
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.includes(sep);
  if (escapesFixtureRoot) {
    throw new Error(`Invalid corpus id: ${args.corpusId}`);
  }
  return candidate;
}

function replayDataDir(replayRoot: string): string {
  return dirname(resolve(replayRoot));
}

function buildScenarioDescription(manifest: ReplayCaptureManifest): string {
  const preview = manifest.userInputPreview.trim();
  if (preview.length > 0) {
    return preview;
  }
  return getReplayCaptureInitialTurn(manifest).turnId;
}

export function parseImportDevReplaysArgs(
  argv: string[],
): ProviderAuditDevReplayCliParseResult {
  const args: ProviderAuditImportDevReplaysArgs = {
    replayRoot: getDefaultDevReplayRoot(),
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
    corpusId: DEFAULT_DEV_REPLAY_CORPUS_ID,
    captureIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--") {
      continue;
    }
    if (token === "--replay-root" && next) {
      args.replayRoot = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--fixture-root" && next) {
      args.fixtureRoot = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--corpus-id" && next) {
      args.corpusId = next;
      index += 1;
      continue;
    }
    if (token === "--capture-id" && next) {
      args.captureIds.push(next);
      index += 1;
      continue;
    }
    if (!token.startsWith("--")) {
      args.captureIds.push(token);
      continue;
    }
  }

  args.captureIds = Array.from(new Set(args.captureIds));

  if (args.captureIds.length === 0) {
    throw new Error("At least one replay capture id is required");
  }

  return { args };
}

async function importDevReplayFixture(
  args: ProviderAuditImportDevReplayFixtureArgs,
): Promise<ProviderAuditImportFixtureResult> {
  const dataDir = replayDataDir(args.replayRoot);
  const manifest = readReplayCaptureManifestSync({
    dataDir,
    captureId: args.captureId,
  });
  const taskId = manifest.captureId;
  const destinationDir = join(
    args.fixtureCorpusRoot,
    manifest.providerId,
    taskId,
  );

  await promoteCaptureToFixture({
    dataDir,
    captureId: args.captureId,
    destinationDir,
    corpusId: args.corpusId,
    scenarioId: manifest.captureId,
    scenarioDescription: buildScenarioDescription(manifest),
    model: manifest.execution.model,
    gitSha: null,
    gitResetRef: null,
    workspacePath: BB_DEV_WORKSPACE_PLACEHOLDER,
    runtimeWorkspacePath: BB_DEV_WORKSPACE_PLACEHOLDER,
    envWorkspacePath: BB_DEV_WORKSPACE_PLACEHOLDER,
    runtimeWorkspaceGitStart: null,
    runtimeWorkspaceGitEnd: null,
  });

  return {
    corpusId: args.corpusId,
    providerId: manifest.providerId,
    taskId,
    fixturePath: join(args.corpusId, manifest.providerId, taskId),
  };
}

export async function importDevReplayFixtures(
  args: ProviderAuditImportDevReplaysArgs,
): Promise<ProviderAuditImportFixturesResult> {
  const fixtureCorpusRoot = resolveFixtureCorpusRoot({
    fixtureRoot: args.fixtureRoot,
    corpusId: args.corpusId,
  });
  rmSync(fixtureCorpusRoot, { recursive: true, force: true });
  mkdirSync(fixtureCorpusRoot, { recursive: true });

  const fixtures = await Promise.all(
    args.captureIds.map((captureId) =>
      importDevReplayFixture({
        replayRoot: args.replayRoot,
        fixtureCorpusRoot,
        corpusId: args.corpusId,
        captureId,
      }),
    ),
  );

  return {
    corpusId: args.corpusId,
    fixtureRoot: fixtureCorpusRoot,
    fixtures: fixtures.sort((left, right) => {
      if (left.providerId !== right.providerId) {
        return left.providerId.localeCompare(right.providerId);
      }
      return left.taskId.localeCompare(right.taskId);
    }),
  };
}
