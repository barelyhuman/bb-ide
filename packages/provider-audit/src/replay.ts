import { mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createProviderForId,
  type AgentRuntimeCaptureEntry,
  type AgentRuntimeRawProviderEventCaptureEntry,
  type AgentRuntimeTranslatedThreadEventCaptureEntry,
} from "@bb/agent-runtime";
import type { ThreadEvent } from "@bb/domain";
import { buildBundle, writeBundle } from "./capture.js";
import type {
  ProviderAuditBundle,
  ProviderAuditClientRequest,
  ProviderAuditFixtureBundle,
  ProviderAuditManifest,
  ProviderAuditReplayFixtureResult,
  ProviderAuditReplayFixturesArgs,
  ProviderAuditReplayFixturesResult,
} from "./types.js";

const DEFAULT_FIXTURE_ROOT = resolve(
  fileURLToPath(new URL("../fixtures", import.meta.url)),
);

interface ProviderAuditReplayCliParseResult {
  args: ProviderAuditReplayFixturesArgs;
}

function readJsonFile<TValue>(filePath: string): TValue {
  return JSON.parse(readFileSync(filePath, "utf8")) as TValue;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function readDirNames(path: string): string[] {
  return readdirSync(path)
    .filter((entry) => entry.startsWith(".") === false)
    .sort((left, right) => left.localeCompare(right));
}

function loadFixtureBundle(args: {
  fixtureRoot: string;
  corpusId: string;
  providerId: string;
  taskId: string;
}): ProviderAuditFixtureBundle {
  const fixturePath = join(args.fixtureRoot, args.corpusId, args.providerId, args.taskId);
  return {
    corpusId: args.corpusId,
    providerId: args.providerId,
    taskId: args.taskId,
    fixturePath,
    manifestPath: join(fixturePath, "manifest.json"),
    manifest: readJsonFile<ProviderAuditManifest>(join(fixturePath, "manifest.json")),
    clientRequests: readJsonFile<ProviderAuditClientRequest[]>(
      join(fixturePath, "client-requests.json"),
    ),
    rawProviderEvents: readJsonFile<AgentRuntimeRawProviderEventCaptureEntry[]>(
      join(fixturePath, "raw-provider-events.json"),
    ),
  };
}

function getThreadIdFromParams(
  rawEvent: { params?: unknown },
): string | undefined {
  if (!isRecord(rawEvent.params)) {
    return undefined;
  }
  const threadId = rawEvent.params.threadId;
  return typeof threadId === "string" ? threadId : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stampTranslatedEvent(args: {
  event: ThreadEvent;
  bbThreadId: string;
  providerThreadId: string | undefined;
  sourceThreadId: string | undefined;
}): ThreadEvent {
  const stamped = structuredClone(args.event);
  const eventRecord = stamped as Record<string, unknown>;

  eventRecord.threadId = args.bbThreadId;

  if (args.providerThreadId) {
    eventRecord.providerThreadId = args.providerThreadId;
  } else if (
    args.sourceThreadId &&
    args.sourceThreadId !== args.bbThreadId &&
    stamped.type !== "thread/identity"
  ) {
    eventRecord.providerThreadId = args.sourceThreadId;
  }

  return stamped;
}

function translateRawProviderEvents(args: {
  manifest: ProviderAuditManifest;
  rawProviderEvents: AgentRuntimeRawProviderEventCaptureEntry[];
}): AgentRuntimeTranslatedThreadEventCaptureEntry[] {
  const adapter = createProviderForId(args.manifest.providerId);
  let providerThreadId: string | undefined;
  const translated: AgentRuntimeTranslatedThreadEventCaptureEntry[] = [];

  for (const rawProviderEvent of args.rawProviderEvents) {
    const sourceThreadId =
      rawProviderEvent.sourceThreadId ??
      getThreadIdFromParams(rawProviderEvent.rawEvent);
    const events = adapter.translateEvent(rawProviderEvent.rawEvent, {
      threadId: sourceThreadId,
    });

    for (const event of events) {
      const candidateProviderThreadId =
        event.type === "thread/identity"
          ? event.providerThreadId
          : providerThreadId;
      const stampedEvent = stampTranslatedEvent({
        event,
        bbThreadId: args.manifest.threadId,
        providerThreadId: candidateProviderThreadId,
        sourceThreadId,
      });

      if (
        stampedEvent.type === "thread/identity" &&
        typeof stampedEvent.providerThreadId === "string" &&
        stampedEvent.providerThreadId.length > 0
      ) {
        providerThreadId = stampedEvent.providerThreadId;
      }

      translated.push({
        kind: "translated-thread-event",
        capturedAt: rawProviderEvent.capturedAt,
        providerId: rawProviderEvent.providerId,
        rawCaptureId: rawProviderEvent.captureId,
        rawMethod: rawProviderEvent.rawEvent.method,
        event: stampedEvent,
      });
    }
  }

  return translated;
}

export function listFixtureBundles(
  args: ProviderAuditReplayFixturesArgs,
): ProviderAuditFixtureBundle[] {
  const fixtureRoot = resolve(args.fixtureRoot);
  const corpusIds =
    args.corpusId !== undefined
      ? [args.corpusId]
      : readDirNames(fixtureRoot).filter((entry) =>
          isDirectory(join(fixtureRoot, entry)),
        );

  const fixtures: ProviderAuditFixtureBundle[] = [];

  for (const corpusId of corpusIds) {
    const corpusPath = join(fixtureRoot, corpusId);
    if (!isDirectory(corpusPath)) {
      continue;
    }
    const providerIds =
      args.providerId !== undefined
        ? [args.providerId]
        : readDirNames(corpusPath).filter((entry) =>
            isDirectory(join(corpusPath, entry)),
          );

    for (const providerId of providerIds) {
      const providerPath = join(corpusPath, providerId);
      if (!isDirectory(providerPath)) {
        continue;
      }
      const taskIds =
        args.taskId !== undefined
          ? [args.taskId]
          : readDirNames(providerPath).filter((entry) =>
              isDirectory(join(providerPath, entry)),
            );

      for (const taskId of taskIds) {
        const taskPath = join(providerPath, taskId);
        if (!isDirectory(taskPath)) {
          continue;
        }
        fixtures.push(
          loadFixtureBundle({
            fixtureRoot,
            corpusId,
            providerId,
            taskId,
          }),
        );
      }
    }
  }

  return fixtures.sort((left, right) => {
    if (left.corpusId !== right.corpusId) {
      return left.corpusId.localeCompare(right.corpusId);
    }
    if (left.providerId !== right.providerId) {
      return left.providerId.localeCompare(right.providerId);
    }
    return left.taskId.localeCompare(right.taskId);
  });
}

function withReplayOutputDir(args: {
  bundle: ProviderAuditBundle;
  outputRoot: string;
  fixture: ProviderAuditFixtureBundle;
}): ProviderAuditBundle {
  const outputDir = join(
    resolve(args.outputRoot),
    args.fixture.corpusId,
    args.fixture.providerId,
    args.fixture.taskId,
  );
  mkdirSync(outputDir, { recursive: true });
  return {
    ...args.bundle,
    manifest: {
      ...args.bundle.manifest,
      outputDir,
    },
  };
}

function replayFixtureBundle(args: {
  fixture: ProviderAuditFixtureBundle;
  outputRoot?: string;
}): ProviderAuditReplayFixtureResult {
  const translatedCaptures = translateRawProviderEvents({
    manifest: args.fixture.manifest,
    rawProviderEvents: args.fixture.rawProviderEvents,
  });
  const captures: AgentRuntimeCaptureEntry[] = [
    ...args.fixture.rawProviderEvents,
    ...translatedCaptures,
  ];

  const baseBundle = buildBundle({
    manifest: args.fixture.manifest,
    captures,
    clientRequests: args.fixture.clientRequests,
  });

  if (!args.outputRoot) {
    return {
      fixture: args.fixture,
      bundle: baseBundle,
    };
  }

  const outputBundle = withReplayOutputDir({
    bundle: baseBundle,
    outputRoot: args.outputRoot,
    fixture: args.fixture,
  });
  writeBundle(outputBundle);
  return {
    fixture: args.fixture,
    bundle: outputBundle,
    outputDir: outputBundle.manifest.outputDir,
  };
}

export function replayFixtures(
  args: ProviderAuditReplayFixturesArgs,
): ProviderAuditReplayFixturesResult {
  const fixtureRoot = args.fixtureRoot ? resolve(args.fixtureRoot) : DEFAULT_FIXTURE_ROOT;
  const fixtures = listFixtureBundles({
    ...args,
    fixtureRoot,
  });
  return {
    fixtures: fixtures.map((fixture) =>
      replayFixtureBundle({
        fixture,
        outputRoot: args.outputRoot,
      }),
    ),
  };
}

export function parseReplayFixturesArgs(
  argv: string[],
): ProviderAuditReplayCliParseResult {
  const args: ProviderAuditReplayFixturesArgs = {
    fixtureRoot: DEFAULT_FIXTURE_ROOT,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--") {
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
    if (token === "--provider" && next) {
      args.providerId = next;
      index += 1;
      continue;
    }
    if (token === "--task" && next) {
      args.taskId = next;
      index += 1;
      continue;
    }
    if (token === "--output-root" && next) {
      args.outputRoot = resolve(next);
      index += 1;
      continue;
    }
  }

  return { args };
}

export function summarizeReplayResults(
  result: ProviderAuditReplayFixturesResult,
): Array<Record<string, number | string>> {
  return result.fixtures.map(({ fixture, bundle }) => ({
    corpusId: fixture.corpusId,
    providerId: fixture.providerId,
    taskId: fixture.taskId,
    rawProviderEventCount: bundle.auditReport.summary.rawProviderEventCount,
    translatedThreadEventCount:
      bundle.auditReport.summary.translatedThreadEventCount,
    viewMessageCount: bundle.auditReport.summary.viewMessageCount,
    timelineRowCount: bundle.auditReport.summary.timelineRowCount,
    debugRawEventCount: bundle.auditReport.summary.debugRawEventCount,
    unexpectedUntranslatedRawEventCount:
      bundle.auditReport.summary.unexpectedUntranslatedRawEventCount,
    fixturePath: relative(process.cwd(), fixture.fixturePath),
  }));
}
