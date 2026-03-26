import type {
  DynamicTool,
  ThreadExecutionOptions,
  ThreadEvent,
  ThreadEventRow,
  TimelineRow,
  ViewMessage,
  ToolCallResponse,
} from "@bb/domain";
import type { AgentRuntimeCaptureEntry } from "@bb/agent-runtime";

export interface ProviderAuditScenarioExecutionOptions {
  reasoningLevel?: ThreadExecutionOptions["reasoningLevel"];
  sandboxMode?: ThreadExecutionOptions["sandboxMode"];
  serviceTier?: ThreadExecutionOptions["serviceTier"];
}

export interface ProviderAuditScenarioWorkspaceFile {
  path: string;
  content: string;
}

export interface ProviderAuditScenarioToolFixture {
  tool: DynamicTool;
  response: ToolCallResponse;
}

export interface ProviderAuditScenarioOverride {
  turns?: string[];
  instructions?: string;
  execution?: ProviderAuditScenarioExecutionOptions;
  workspaceMode?: "repo" | "scratch";
  workspaceFiles?: ProviderAuditScenarioWorkspaceFile[];
  toolFixtures?: ProviderAuditScenarioToolFixture[];
}

export interface ProviderAuditScenario {
  id: string;
  description: string;
  turns: string[];
  instructions?: string;
  execution?: ProviderAuditScenarioExecutionOptions;
  workspaceMode?: "repo" | "scratch";
  workspaceFiles?: ProviderAuditScenarioWorkspaceFile[];
  toolFixtures?: ProviderAuditScenarioToolFixture[];
  providerOverrides?: Record<string, ProviderAuditScenarioOverride>;
}

export interface ProviderAuditCliArgs {
  providerId: string;
  scenarioId: string;
  outputDir?: string;
  workspacePath: string;
  model?: string;
  prompt?: string;
  gitResetRef?: string;
  timeoutMs: number;
}

export interface ProviderAuditImportFixturesArgs {
  sourceRoot: string;
  fixtureRoot: string;
  corpusId: string;
}

export interface ProviderAuditReplayFixturesArgs {
  fixtureRoot: string;
  corpusId?: string;
  providerId?: string;
  taskId?: string;
  outputRoot?: string;
}

export interface ProviderAuditGitSnapshot {
  headSha: string | null;
  isClean: boolean;
  statusLines: string[];
}

export interface ProviderAuditManifest {
  providerId: string;
  scenarioId: string;
  scenarioDescription: string;
  model: string | null;
  source: "live-capture";
  capturedAt: number;
  completedAt: number;
  gitSha: string | null;
  workspacePath: string;
  runtimeWorkspacePath: string;
  envWorkspacePath: string;
  outputDir: string;
  threadId: string;
  projectId: string;
  turns: string[];
  gitResetRef: string | null;
  runtimeWorkspaceGitStart: ProviderAuditGitSnapshot | null;
  runtimeWorkspaceGitEnd: ProviderAuditGitSnapshot | null;
}

export interface ProviderAuditClientRequest {
  id: string;
  turnIndex: number;
  type: "client/thread/start" | "client/turn/requested";
  requestMethod: "thread/start" | "turn/start";
  text: string;
  createdAt: number;
}

export type ProviderAuditRawEventTranslationExpectation =
  | "expected-none"
  | "expected-some"
  | "unknown";

export interface ProviderAuditUntranslatedRawEvent {
  captureId: string;
  method: string;
  kind: string;
  capturedAt: number;
  expectation: ProviderAuditRawEventTranslationExpectation;
}

export interface ProviderAuditDebugRawEvent {
  messageId: string;
  rawType: string;
  reason: "ignored-noise" | "duplicate-event" | "unhandled";
  sourceSeqStart: number;
  sourceSeqEnd: number;
}

export interface ProviderAuditToolCallSummary {
  requestCount: number;
  resultCount: number;
  failedCount: number;
}

export interface ProviderAuditStderrSummary {
  lineCount: number;
  sample: Extract<AgentRuntimeCaptureEntry, { kind: "provider-stderr" }>[];
}

export interface ProviderAuditReport {
  summary: {
    rawProviderEventCount: number;
    translatedThreadEventCount: number;
    viewMessageCount: number;
    timelineRowCount: number;
    debugRawEventCount: number;
    unexpectedUntranslatedRawEventCount: number;
    toolCallRequestCount: number;
    toolCallResultCount: number;
    providerStderrCount: number;
    processLifecycleCount: number;
  };
  rawProviderMethods: string[];
  rawProviderEventKinds: string[];
  translatedEventTypes: ThreadEvent["type"][];
  untranslatedRawProviderEvents: ProviderAuditUntranslatedRawEvent[];
  unexpectedUntranslatedRawProviderEvents: ProviderAuditUntranslatedRawEvent[];
  debugRawEvents: ProviderAuditDebugRawEvent[];
  toolCalls: ProviderAuditToolCallSummary;
  providerStderr: ProviderAuditStderrSummary;
  processLifecycle: Array<
    Extract<
      AgentRuntimeCaptureEntry,
      { kind: "provider-process-error" | "provider-process-exit" }
    >
  >;
  attentionNeeded: string[];
}

export interface ProviderAuditBundle {
  manifest: ProviderAuditManifest;
  captures: AgentRuntimeCaptureEntry[];
  clientRequests: ProviderAuditClientRequest[];
  rawProviderEvents: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "raw-provider-event" }
  >[];
  translatedCaptures: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "translated-thread-event" }
  >[];
  toolCallRequests: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "tool-call-request" }
  >[];
  toolCallResults: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "tool-call-result" }
  >[];
  providerStderr: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "provider-stderr" }
  >[];
  processLifecycle: Array<
    Extract<
      AgentRuntimeCaptureEntry,
      { kind: "provider-process-error" | "provider-process-exit" }
    >
  >;
  threadEvents: ThreadEvent[];
  threadEventRows: ThreadEventRow[];
  viewMessages: ViewMessage[];
  auditViewMessages: ViewMessage[];
  timelineRows: TimelineRow[];
  timelineText: string;
  timelineVerboseText: string;
  auditReport: ProviderAuditReport;
}

export interface ProviderAuditFixtureBundle {
  corpusId: string;
  providerId: string;
  taskId: string;
  fixturePath: string;
  manifestPath: string;
  manifest: ProviderAuditManifest;
  clientRequests: ProviderAuditClientRequest[];
  rawProviderEvents: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "raw-provider-event" }
  >[];
}

export interface ProviderAuditRunResult {
  outputDir: string;
  bundle: ProviderAuditBundle;
}

export interface ProviderAuditImportFixtureResult {
  corpusId: string;
  providerId: string;
  taskId: string;
  fixturePath: string;
}

export interface ProviderAuditImportFixturesResult {
  corpusId: string;
  fixtureRoot: string;
  fixtures: ProviderAuditImportFixtureResult[];
}

export interface ProviderAuditReplayFixtureResult {
  fixture: ProviderAuditFixtureBundle;
  bundle: ProviderAuditBundle;
  outputDir?: string;
}

export interface ProviderAuditReplayFixturesResult {
  fixtures: ProviderAuditReplayFixtureResult[];
}

export interface ProviderAuditLadleFixture {
  id: string;
  corpusId: string;
  providerId: string;
  taskId: string;
  scenarioDescription: string;
  threadStatus: string;
  latestActivityRowId: string | null;
  timelineRowCount: number;
  viewMessageCount: number;
  timelineRows: TimelineRow[];
}

export interface ProviderAuditLadleStoryData {
  fixtures: ProviderAuditLadleFixture[];
}

export interface ProviderAuditExportLadleDataArgs
  extends ProviderAuditReplayFixturesArgs {
  outputPath: string;
}

export interface ProviderAuditExportLadleDataResult {
  fixtureCount: number;
  outputPath: string;
}
