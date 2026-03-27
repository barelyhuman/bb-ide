import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  createAgentRuntime,
  type AgentRuntimeCaptureEntry,
} from "@bb/agent-runtime";
import {
  buildTimelineRows,
  decodeRow,
  formatTimelineAsText,
  toViewMessages,
} from "@bb/core-ui";
import type { ThreadEventRow, ToolCallRequest, ToolCallResponse } from "@bb/domain";
import type {
  ProviderAuditBundle,
  ProviderAuditClientRequest,
  ProviderAuditCliArgs,
  ProviderAuditDebugRawEvent,
  ProviderAuditGitSnapshot,
  ProviderAuditManifest,
  ProviderAuditRawEventTranslationExpectation,
  ProviderAuditReport,
  ProviderAuditRunResult,
  ProviderAuditScenario,
  ProviderAuditScenarioExecutionOptions,
  ProviderAuditScenarioOverride,
  ProviderAuditScenarioToolFixture,
  ProviderAuditUntranslatedRawEvent,
} from "./types.js";

const DEFAULT_PROVIDER_ID = "codex";
const DEFAULT_SCENARIO_ID = "excalidraw-ttd-explanation";
const DEFAULT_PROJECT_ID = "provider-audit";
const DEFAULT_THREAD_ID = "provider-audit-thread";
const DEFAULT_TIMEOUT_MS = 90_000;

const BUILT_IN_SCENARIOS: Record<string, ProviderAuditScenario> = {
  "excalidraw-ttd-explanation": {
    id: "excalidraw-ttd-explanation",
    description: "Provider-neutral explanation task against the real Excalidraw repo",
    workspaceMode: "repo",
    turns: [
      "I'm trying to understand Excalidraw's text-to-diagram flow before changing it. Please trace the flow from the dialog UI through chat history/state updates to the code that turns the final response into scene updates. Call out the main files, the key types, and any tricky state transitions or failure cases. Keep it grounded in the current codebase with specific file references.",
      "What's the safest extension point if I want to tweak the UI without changing the scene-generation logic?",
    ],
  },
  "excalidraw-search-feature": {
    id: "excalidraw-search-feature",
    description: "Provider-neutral feature task against the real Excalidraw repo",
    workspaceMode: "repo",
    turns: [
      "Add a small result summary to the canvas search sidebar: show `N results` when there are matches, show a clear `No matches found` empty state when the query is non-empty and there are none, and keep the existing keyboard navigation behavior intact. Update the relevant tests and validate the focused test file.",
      "Summarize the files you changed and the validation you ran.",
    ],
  },
  "excalidraw-search-bugfix": {
    id: "excalidraw-search-bugfix",
    description: "Provider-neutral bug-fix task against the real Excalidraw repo",
    workspaceMode: "repo",
    turns: [
      "There's a usability bug in the canvas search sidebar: if I navigate to a later match and then change the query so fewer matches remain, focus can end up pointing at nothing. Fix it so a query change resets focus to the first match when matches exist, and add a regression test validating the behavior.",
      "Explain why the regression would have failed before your change.",
    ],
  },
};

interface PreparedAuditWorkspace {
  runtimeWorkspacePath: string;
  envWorkspacePath: string;
}

interface RawEventKindDetails {
  kind: string;
  expectation: ProviderAuditRawEventTranslationExpectation;
}

function printHelp(): void {
  const scenarioLines = Object.values(BUILT_IN_SCENARIOS)
    .map((scenario) => `  ${scenario.id.padEnd(24)} ${scenario.description}`)
    .join("\n");
  console.log(`Usage: bb-provider-audit [options]

Options:
  --provider <id>      Provider id. Default: ${DEFAULT_PROVIDER_ID}
  --scenario <id>      Scenario id. Default: ${DEFAULT_SCENARIO_ID}
  --prompt <text>      Override the first scenario prompt
  --model <id>         Optional model override
  --workspace <path>   Env/source workspace path. Default: current directory
  --output <path>      Output directory. Default: ${join(tmpdir(), "bb-provider-audit")}
  --git-reset-ref <r>  Reset the repo workspace to this git ref before and after capture
  --timeout-ms <ms>    Timeout waiting for turn completion. Default: ${DEFAULT_TIMEOUT_MS}
  --help               Show this message

Built-in scenarios:
${scenarioLines}`);
}

export function parseCliArgs(argv: string[]): ProviderAuditCliArgs {
  const args: ProviderAuditCliArgs = {
    providerId: DEFAULT_PROVIDER_ID,
    scenarioId: DEFAULT_SCENARIO_ID,
    workspacePath: process.cwd(),
    timeoutMs: DEFAULT_TIMEOUT_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];

    if (token === "--") {
      continue;
    }
    if (token === "--provider" && next) {
      args.providerId = next;
      index += 1;
      continue;
    }
    if (token === "--scenario" && next) {
      args.scenarioId = next;
      index += 1;
      continue;
    }
    if (token === "--output" && next) {
      args.outputDir = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--workspace" && next) {
      args.workspacePath = resolve(next);
      index += 1;
      continue;
    }
    if (token === "--model" && next) {
      args.model = next;
      index += 1;
      continue;
    }
    if (token === "--prompt" && next) {
      args.prompt = next;
      index += 1;
      continue;
    }
    if (token === "--git-reset-ref" && next) {
      args.gitResetRef = next;
      index += 1;
      continue;
    }
    if (token === "--timeout-ms" && next) {
      args.timeoutMs = Number.parseInt(next, 10);
      index += 1;
      continue;
    }
    if (token === "--help" || token === "-h") {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function defaultOutputDir(providerId: string, scenarioId: string): string {
  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  return join(
    tmpdir(),
    "bb-provider-audit",
    `${stamp}-${sanitizeSegment(providerId)}-${sanitizeSegment(scenarioId)}`,
  );
}

function getGitSha(workspacePath: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: workspacePath,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

function getGitStatusLines(workspacePath: string): string[] | null {
  try {
    const output = execFileSync(
      "git",
      ["status", "--short", "--untracked-files=all"],
      {
        cwd: workspacePath,
        encoding: "utf8",
      },
    ).trim();
    return output.length === 0 ? [] : output.split("\n");
  } catch {
    return null;
  }
}

function getGitSnapshot(workspacePath: string): ProviderAuditGitSnapshot | null {
  const headSha = getGitSha(workspacePath);
  const statusLines = getGitStatusLines(workspacePath);
  if (headSha === null || statusLines === null) {
    return null;
  }
  return {
    headSha,
    isClean: statusLines.length === 0,
    statusLines,
  };
}

function resetGitWorkspaceToRef(workspacePath: string, gitRef: string): void {
  try {
    execFileSync("git", ["reset", "--hard", gitRef], {
      cwd: workspacePath,
      encoding: "utf8",
      stdio: "pipe",
    });
    execFileSync("git", ["clean", "-fd"], {
      cwd: workspacePath,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to reset git workspace ${workspacePath} to ${gitRef}: ${detail}`,
    );
  }
}

function loadDotEnv(workspacePath: string): Record<string, string> {
  try {
    const content = readFileSync(join(workspacePath, ".env"), "utf8");
    const env: Record<string, string> = {};
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separatorIndex = trimmed.indexOf("=");
      if (separatorIndex < 0) continue;
      const key = trimmed.slice(0, separatorIndex).trim();
      const value = trimmed.slice(separatorIndex + 1).trim();
      if (key.length === 0) continue;
      if (process.env[key] === undefined) {
        env[key] = value;
      }
    }
    return env;
  } catch {
    return {};
  }
}

function cloneWorkspaceFiles(
  workspaceFiles: ProviderAuditScenario["workspaceFiles"],
): ProviderAuditScenario["workspaceFiles"] {
  return workspaceFiles?.map((file) => ({ ...file }));
}

function cloneToolFixtures(
  toolFixtures: ProviderAuditScenario["toolFixtures"],
): ProviderAuditScenario["toolFixtures"] {
  return toolFixtures?.map((fixture) => ({
    tool: {
      ...fixture.tool,
      inputSchema: JSON.parse(JSON.stringify(fixture.tool.inputSchema)),
    },
    response: structuredClone(fixture.response),
  }));
}

function applyScenarioOverride(
  scenario: ProviderAuditScenario,
  override: ProviderAuditScenarioOverride | undefined,
): ProviderAuditScenario {
  if (!override) {
    return scenario;
  }

  return {
    ...scenario,
    ...(override.turns ? { turns: override.turns.slice() } : {}),
    ...(override.execution
      ? { execution: { ...override.execution } }
      : {}),
    ...(override.workspaceMode ? { workspaceMode: override.workspaceMode } : {}),
    ...(override.workspaceFiles
      ? { workspaceFiles: cloneWorkspaceFiles(override.workspaceFiles) }
      : {}),
    ...(override.toolFixtures
      ? { toolFixtures: cloneToolFixtures(override.toolFixtures) }
      : {}),
  };
}

function resolveScenario(args: ProviderAuditCliArgs): ProviderAuditScenario {
  const scenarioTemplate = BUILT_IN_SCENARIOS[args.scenarioId];
  if (!scenarioTemplate) {
    throw new Error(`Unknown scenario "${args.scenarioId}"`);
  }

  const baseScenario: ProviderAuditScenario = {
    ...scenarioTemplate,
    turns: scenarioTemplate.turns.slice(),
    execution: scenarioTemplate.execution
      ? { ...scenarioTemplate.execution }
      : undefined,
    workspaceFiles: cloneWorkspaceFiles(scenarioTemplate.workspaceFiles),
    toolFixtures: cloneToolFixtures(scenarioTemplate.toolFixtures),
    providerOverrides: undefined,
  };
  const providerScenario = applyScenarioOverride(
    baseScenario,
    scenarioTemplate.providerOverrides?.[args.providerId],
  );

  return {
    ...providerScenario,
    turns:
      args.prompt && providerScenario.turns.length > 0
        ? [args.prompt, ...providerScenario.turns.slice(1)]
        : providerScenario.turns.slice(),
  };
}

function waitForCondition(
  predicate: () => boolean,
  options: { timeoutMs: number; label: string },
): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    const startedAt = Date.now();
    const check = () => {
      if (predicate()) {
        resolvePromise();
        return;
      }
      if (Date.now() - startedAt > options.timeoutMs) {
        rejectPromise(
          new Error(
            `Timeout after ${options.timeoutMs}ms waiting for ${options.label}`,
          ),
        );
        return;
      }
      setTimeout(check, 100);
    };
    check();
  });
}

function ensureDirectoryForFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

function prepareScenarioWorkspace(args: {
  outputDir: string;
  scenario: ProviderAuditScenario;
  workspacePath: string;
}): PreparedAuditWorkspace {
  if (args.scenario.workspaceMode !== "scratch") {
    return {
      runtimeWorkspacePath: args.workspacePath,
      envWorkspacePath: args.workspacePath,
    };
  }

  const runtimeWorkspacePath = join(args.outputDir, "workspace");
  mkdirSync(runtimeWorkspacePath, { recursive: true });

  writeFileSync(
    join(runtimeWorkspacePath, "README.md"),
    "# Provider Audit Scratch Workspace\n",
  );

  for (const file of args.scenario.workspaceFiles ?? []) {
    const filePath = join(runtimeWorkspacePath, file.path);
    ensureDirectoryForFile(filePath);
    writeFileSync(filePath, file.content);
  }

  return {
    runtimeWorkspacePath,
    envWorkspacePath: args.workspacePath,
  };
}

function buildExecutionOptions(args: {
  model?: string;
  execution?: ProviderAuditScenarioExecutionOptions;
}): {
  model?: string;
  serviceTier?: ProviderAuditScenarioExecutionOptions["serviceTier"];
  reasoningLevel?: ProviderAuditScenarioExecutionOptions["reasoningLevel"];
  sandboxMode: NonNullable<ProviderAuditScenarioExecutionOptions["sandboxMode"]>;
} {
  return {
    sandboxMode: args.execution?.sandboxMode ?? "danger-full-access",
    ...(args.execution?.reasoningLevel
      ? { reasoningLevel: args.execution.reasoningLevel }
      : {}),
    ...(args.execution?.serviceTier
      ? { serviceTier: args.execution.serviceTier }
      : {}),
    ...(args.model ? { model: args.model } : {}),
  };
}

function buildClientRequestRows(args: {
  clientRequests: ProviderAuditClientRequest[];
  execution?: ProviderAuditScenarioExecutionOptions;
  model?: string;
  threadId: string;
}): ThreadEventRow[] {
  const execution = buildExecutionOptions({
    model: args.model,
    execution: args.execution,
  });

  return args.clientRequests.map((request) => {
    return {
      id: request.id,
      threadId: args.threadId,
      seq: 0,
      type: request.type,
      data: {
        direction: "outbound",
        source: "tell",
        initiator: "user",
        input: [{ type: "text", text: request.text }],
        request: {
          method: request.requestMethod,
          params: {},
        },
        execution,
      },
      createdAt: request.createdAt,
    };
  });
}

function buildThreadEventRows(args: {
  translatedCaptures: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "translated-thread-event" }
  >[];
  clientRequests: ProviderAuditClientRequest[];
  execution?: ProviderAuditScenarioExecutionOptions;
  model?: string;
}): ThreadEventRow[] {
  const clientRows = buildClientRequestRows({
    clientRequests: args.clientRequests,
    execution: args.execution,
    model: args.model,
    threadId: DEFAULT_THREAD_ID,
  });

  const providerRows = args.translatedCaptures.map((entry, index) => {
    const { type, threadId: _ignoredThreadId, ...data } = entry.event;
    return {
      id: `audit-row-${index + 1}`,
      threadId: entry.event.threadId,
      seq: 0,
      type,
      data,
      createdAt: entry.capturedAt,
    };
  });

  return [...clientRows, ...providerRows]
    .map((row, index) => ({
      row,
      index,
      priority: row.type.startsWith("client/") ? 0 : 1,
    }))
    .sort((left, right) => {
      if (left.row.createdAt !== right.row.createdAt) {
        return left.row.createdAt - right.row.createdAt;
      }
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }
      return left.index - right.index;
    })
    .map((entry, index) => ({
      ...entry.row,
      seq: index + 1,
    }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getRecordProperty(
  value: Record<string, unknown>,
  key: string,
): Record<string, unknown> | null {
  const next = value[key];
  return isRecord(next) ? next : null;
}

function getStringProperty(
  value: Record<string, unknown>,
  key: string,
): string | undefined {
  const next = value[key];
  return typeof next === "string" ? next : undefined;
}

function getRawSdkMessage(
  entry: Extract<AgentRuntimeCaptureEntry, { kind: "raw-provider-event" }>,
): Record<string, unknown> | null {
  if (entry.rawEvent.method !== "sdk/message") {
    return null;
  }
  if (!isRecord(entry.rawEvent.params)) {
    return null;
  }
  const message = entry.rawEvent.params["message"];
  return isRecord(message) ? message : null;
}

function getMessageContentTypes(message: Record<string, unknown>): string[] {
  const messagePayload = getRecordProperty(message, "message");
  const content = messagePayload?.["content"];
  if (!Array.isArray(content)) {
    return [];
  }

  const types = new Set<string>();
  for (const block of content) {
    if (!isRecord(block)) continue;
    const type = getStringProperty(block, "type");
    if (!type) continue;
    types.add(type);
  }
  return [...types];
}

function hasClaudeParentToolUseId(message: Record<string, unknown>): boolean {
  return typeof message["parent_tool_use_id"] === "string";
}

function describeClaudeRawEventKind(
  entry: Extract<AgentRuntimeCaptureEntry, { kind: "raw-provider-event" }>,
): string {
  if (entry.rawEvent.method !== "sdk/message") {
    return entry.rawEvent.method;
  }
  const message = getRawSdkMessage(entry);
  if (!message) {
    return "sdk/unknown";
  }

  const type = getStringProperty(message, "type");
  if (type === "assistant" || type === "user") {
    const contentTypes = getMessageContentTypes(message);
    if (contentTypes.length === 0) {
      return `sdk/${type}`;
    }
    return `sdk/${type}:${contentTypes.sort().join("+")}`;
  }
  if (type === "system") {
    const subtype = getStringProperty(message, "subtype");
    return subtype ? `sdk/system:${subtype}` : "sdk/system";
  }
  if (type === "stream_event") {
    const event = getRecordProperty(message, "event");
    const eventType = event ? getStringProperty(event, "type") : undefined;
    if (!eventType) {
      return "sdk/stream_event";
    }
    if (eventType === "content_block_start") {
      const contentBlock = event ? getRecordProperty(event, "content_block") : null;
      const contentType = contentBlock
        ? getStringProperty(contentBlock, "type")
        : undefined;
      return contentType
        ? `sdk/stream_event:${eventType}:${contentType}`
        : `sdk/stream_event:${eventType}`;
    }
    if (eventType === "content_block_delta") {
      const delta = event ? getRecordProperty(event, "delta") : null;
      const deltaType = delta ? getStringProperty(delta, "type") : undefined;
      return deltaType
        ? `sdk/stream_event:${eventType}:${deltaType}`
        : `sdk/stream_event:${eventType}`;
    }
    return `sdk/stream_event:${eventType}`;
  }
  return type ? `sdk/${type}` : "sdk/unknown";
}

function describePiRawEventKind(
  entry: Extract<AgentRuntimeCaptureEntry, { kind: "raw-provider-event" }>,
): string {
  if (entry.rawEvent.method !== "sdk/message") {
    return entry.rawEvent.method;
  }
  const message = getRawSdkMessage(entry);
  if (!message) {
    return "sdk/unknown";
  }

  const type = getStringProperty(message, "type");
  if (type === "message_start" || type === "message_end") {
    const payload = getRecordProperty(message, "message");
    const role = payload ? getStringProperty(payload, "role") : undefined;
    return role ? `sdk/${type}:${role}` : `sdk/${type}`;
  }
  if (type === "message_update") {
    const assistantMessageEvent = getRecordProperty(message, "assistantMessageEvent");
    const assistantEventType = assistantMessageEvent
      ? getStringProperty(assistantMessageEvent, "type")
      : undefined;
    return assistantEventType
      ? `sdk/message_update:${assistantEventType}`
      : "sdk/message_update";
  }
  return type ? `sdk/${type}` : "sdk/unknown";
}

function getRawEventKindDetails(
  entry: Extract<AgentRuntimeCaptureEntry, { kind: "raw-provider-event" }>,
): RawEventKindDetails {
  if (entry.providerId === "claude-code") {
    const kind = describeClaudeRawEventKind(entry);
    const message = getRawSdkMessage(entry);
    if (
      kind === "thread/identity" ||
      kind === "sdk/assistant:text" ||
      kind === "sdk/assistant:tool_use" ||
      kind === "sdk/assistant:text+tool_use" ||
      kind === "sdk/user:tool_result" ||
      kind === "sdk/result" ||
      kind === "sdk/stream_event:content_block_delta:text_delta"
    ) {
      return { kind, expectation: "expected-some" };
    }
    if (kind === "sdk/user:text" && message && hasClaudeParentToolUseId(message)) {
      return { kind, expectation: "expected-none" };
    }
    if (
      kind === "sdk/system:init" ||
      kind === "sdk/system:task_started" ||
      kind === "sdk/system:task_progress" ||
      kind === "sdk/system:task_notification" ||
      kind === "sdk/rate_limit_event" ||
      kind === "sdk/assistant:thinking" ||
      kind === "sdk/stream_event:message_start" ||
      kind === "sdk/stream_event:content_block_start:text" ||
      kind === "sdk/stream_event:content_block_start:thinking" ||
      kind === "sdk/stream_event:content_block_start:tool_use" ||
      kind === "sdk/stream_event:content_block_stop" ||
      kind === "sdk/stream_event:message_delta" ||
      kind === "sdk/stream_event:message_stop" ||
      kind === "sdk/stream_event:content_block_delta:thinking_delta" ||
      kind === "sdk/stream_event:content_block_delta:signature_delta" ||
      kind === "sdk/stream_event:content_block_delta:input_json_delta"
    ) {
      return { kind, expectation: "expected-none" };
    }
    return { kind, expectation: "unknown" };
  }

  if (entry.providerId === "pi") {
    const kind = describePiRawEventKind(entry);
    if (
      kind === "thread/identity" ||
      kind === "sdk/agent_start" ||
      kind === "sdk/agent_end" ||
      kind === "sdk/message_update:text_delta" ||
      kind === "sdk/tool_execution_start" ||
      kind === "sdk/tool_execution_end"
    ) {
      return { kind, expectation: "expected-some" };
    }
    if (
      kind === "sdk/turn_start" ||
      kind === "sdk/message_start:user" ||
      kind === "sdk/message_end:user" ||
      kind === "sdk/message_start:assistant" ||
      kind === "sdk/message_start:toolResult" ||
      kind === "sdk/message_end:toolResult" ||
      kind === "sdk/message_update:text_start" ||
      kind === "sdk/message_update:text_end" ||
      kind === "sdk/message_update:thinking_start" ||
      kind === "sdk/message_update:thinking_delta" ||
      kind === "sdk/message_update:thinking_end" ||
      kind === "sdk/message_update:toolcall_start" ||
      kind === "sdk/message_update:toolcall_delta" ||
      kind === "sdk/message_update:toolcall_end" ||
      kind === "sdk/tool_execution_update" ||
      kind === "sdk/message_end:assistant" ||
      kind === "sdk/turn_end"
    ) {
      return { kind, expectation: "expected-none" };
    }
    return { kind, expectation: "unknown" };
  }

  const kind = entry.rawEvent.method;
  if (kind === "item/commandExecution/terminalInteraction") {
    if (isRecord(entry.rawEvent.params)) {
      const stdin = getStringProperty(entry.rawEvent.params, "stdin");
      if (stdin !== undefined && stdin.length === 0) {
        return { kind, expectation: "expected-none" };
      }
    }
    return { kind, expectation: "unknown" };
  }
  if (
    kind === "thread/status/changed" ||
    kind === "account/rateLimits/updated"
  ) {
    return { kind, expectation: "expected-none" };
  }
  if (
    kind === "thread/started" ||
    kind === "thread/name/updated" ||
    kind === "thread/compacted" ||
    kind === "turn/started" ||
    kind === "turn/completed" ||
    kind === "item/started" ||
    kind === "item/completed" ||
    kind === "item/agentMessage/delta" ||
    kind === "item/commandExecution/outputDelta" ||
    kind === "item/fileChange/outputDelta" ||
    kind === "item/reasoning/summaryTextDelta" ||
    kind === "item/reasoning/textDelta" ||
    kind === "item/plan/delta" ||
    kind === "item/mcpToolCall/progress" ||
    kind === "thread/tokenUsage/updated" ||
    kind === "turn/plan/updated" ||
    kind === "turn/diff/updated" ||
    kind === "error" ||
    kind === "deprecationNotice" ||
    kind === "configWarning"
  ) {
    return { kind, expectation: "expected-some" };
  }
  return { kind, expectation: "unknown" };
}

function buildUntranslatedRawProviderEvents(
  rawProviderEvents: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "raw-provider-event" }
  >[],
  translatedCaptures: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "translated-thread-event" }
  >[],
): ProviderAuditUntranslatedRawEvent[] {
  const translatedCountByRawCaptureId = new Map<string, number>();
  for (const entry of translatedCaptures) {
    if (!entry.rawCaptureId) continue;
    translatedCountByRawCaptureId.set(
      entry.rawCaptureId,
      (translatedCountByRawCaptureId.get(entry.rawCaptureId) ?? 0) + 1,
    );
  }

  return rawProviderEvents
    .filter((entry) => !translatedCountByRawCaptureId.has(entry.captureId))
    .map((entry) => {
      const kindDetails = getRawEventKindDetails(entry);
      return {
        captureId: entry.captureId,
        method: entry.rawEvent.method,
        kind: kindDetails.kind,
        capturedAt: entry.capturedAt,
        expectation: kindDetails.expectation,
      };
    });
}

function buildDebugRawEvents(
  viewMessages: ProviderAuditBundle["auditViewMessages"],
): ProviderAuditDebugRawEvent[] {
  return viewMessages
    .filter((message) => message.kind === "debug/raw-event")
    .map((message) => ({
      messageId: message.id,
      rawType: message.rawType,
      reason: message.reason,
      sourceSeqStart: message.sourceSeqStart,
      sourceSeqEnd: message.sourceSeqEnd,
    }));
}

function buildAuditReport(args: {
  rawProviderEvents: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "raw-provider-event" }
  >[];
  translatedCaptures: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "translated-thread-event" }
  >[];
  viewMessages: ProviderAuditBundle["viewMessages"];
  auditViewMessages: ProviderAuditBundle["auditViewMessages"];
  timelineRows: ProviderAuditBundle["timelineRows"];
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
  processLifecycle: ProviderAuditBundle["processLifecycle"];
}): ProviderAuditReport {
  const untranslatedRawProviderEvents = buildUntranslatedRawProviderEvents(
    args.rawProviderEvents,
    args.translatedCaptures,
  );
  const unexpectedUntranslatedRawProviderEvents = untranslatedRawProviderEvents.filter(
    (entry) => entry.expectation !== "expected-none",
  );
  const debugRawEvents = buildDebugRawEvents(args.auditViewMessages);
  const attentionNeeded: string[] = [];

  if (unexpectedUntranslatedRawProviderEvents.length > 0) {
    attentionNeeded.push(
      `${unexpectedUntranslatedRawProviderEvents.length} raw provider event(s) expected translation but produced no ThreadEvent`,
    );
  }
  if (debugRawEvents.length > 0) {
    attentionNeeded.push(
      `${debugRawEvents.length} provider-agnostic event(s) still fall back to debug/raw-event output`,
    );
  }
  if (args.toolCallResults.some((entry) => entry.success === false)) {
    attentionNeeded.push("At least one provider tool call failed in the runtime hook");
  }

  return {
    summary: {
      rawProviderEventCount: args.rawProviderEvents.length,
      translatedThreadEventCount: args.translatedCaptures.length,
      viewMessageCount: args.viewMessages.length,
      timelineRowCount: args.timelineRows.length,
      debugRawEventCount: debugRawEvents.length,
      unexpectedUntranslatedRawEventCount:
        unexpectedUntranslatedRawProviderEvents.length,
      toolCallRequestCount: args.toolCallRequests.length,
      toolCallResultCount: args.toolCallResults.length,
      providerStderrCount: args.providerStderr.length,
      processLifecycleCount: args.processLifecycle.length,
    },
    rawProviderMethods: [
      ...new Set(args.rawProviderEvents.map((entry) => entry.rawEvent.method)),
    ],
    rawProviderEventKinds: [
      ...new Set(args.rawProviderEvents.map((entry) => getRawEventKindDetails(entry).kind)),
    ],
    translatedEventTypes: [
      ...new Set(args.translatedCaptures.map((entry) => entry.event.type)),
    ],
    untranslatedRawProviderEvents,
    unexpectedUntranslatedRawProviderEvents,
    debugRawEvents,
    toolCalls: {
      requestCount: args.toolCallRequests.length,
      resultCount: args.toolCallResults.length,
      failedCount: args.toolCallResults.filter((entry) => entry.success === false)
        .length,
    },
    providerStderr: {
      lineCount: args.providerStderr.length,
      sample: args.providerStderr.slice(0, 20),
    },
    processLifecycle: args.processLifecycle,
    attentionNeeded,
  };
}

function writeJson(outputDir: string, fileName: string, value: object): void {
  writeFileSync(join(outputDir, fileName), JSON.stringify(value, null, 2) + "\n");
}

function cloneCaptureEntry(entry: AgentRuntimeCaptureEntry): AgentRuntimeCaptureEntry {
  return structuredClone(entry);
}

function buildToolFixturesByName(
  scenario: ProviderAuditScenario,
): Map<string, ProviderAuditScenarioToolFixture> {
  const byName = new Map<string, ProviderAuditScenarioToolFixture>();
  for (const fixture of scenario.toolFixtures ?? []) {
    byName.set(fixture.tool.name, fixture);
  }
  return byName;
}

function buildDefaultToolResponse(request: ToolCallRequest): ToolCallResponse {
  return {
    contentItems: [
      {
        type: "inputText",
        text: `tool:${request.tool} ok`,
      },
    ],
    success: true,
  };
}

async function runScenario(args: {
  runtime: ReturnType<typeof createAgentRuntime>;
  scenario: ProviderAuditScenario;
  providerId: string;
  model?: string;
  clientRequests: ProviderAuditClientRequest[];
  translatedCaptures: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "translated-thread-event" }
  >[];
  timeoutMs: number;
}): Promise<void> {
  const executionOptions = buildExecutionOptions({
    model: args.model,
    execution: args.scenario.execution,
  });

  await args.runtime.startThread({
    threadId: DEFAULT_THREAD_ID,
    projectId: DEFAULT_PROJECT_ID,
    providerId: args.providerId,
    options: executionOptions,
    dynamicTools: args.scenario.toolFixtures?.map((fixture) => fixture.tool),
  });

  for (let index = 0; index < args.scenario.turns.length; index += 1) {
    const targetTurnCount = index + 1;
    args.clientRequests.push({
      id: `audit-client-row-${index + 1}`,
      turnIndex: index,
      type: index === 0 ? "client/thread/start" : "client/turn/requested",
      requestMethod: index === 0 ? "thread/start" : "turn/start",
      text: args.scenario.turns[index],
      createdAt: Date.now(),
    });
    await args.runtime.runTurn({
      threadId: DEFAULT_THREAD_ID,
      input: [{ type: "text", text: args.scenario.turns[index] }],
      options: buildExecutionOptions({
        model: args.model,
        execution: args.scenario.execution,
      }),
    });
    await waitForCondition(
      () =>
        args.translatedCaptures.filter(
          (entry) => entry.event.type === "turn/completed",
        ).length >= targetTurnCount,
      {
        timeoutMs: args.timeoutMs,
        label: `turn ${targetTurnCount} completion`,
      },
    );
  }
}

function buildManifest(args: {
  providerId: string;
  scenario: ProviderAuditScenario;
  model?: string;
  workspacePath: string;
  runtimeWorkspacePath: string;
  envWorkspacePath: string;
  outputDir: string;
  capturedAt: number;
  completedAt: number;
  gitResetRef?: string;
  runtimeWorkspaceGitStart: ProviderAuditGitSnapshot | null;
  runtimeWorkspaceGitEnd: ProviderAuditGitSnapshot | null;
}): ProviderAuditManifest {
  return {
    providerId: args.providerId,
    scenarioId: args.scenario.id,
    scenarioDescription: args.scenario.description,
    model: args.model ?? null,
    source: "live-capture",
    capturedAt: args.capturedAt,
    completedAt: args.completedAt,
    gitSha: getGitSha(args.workspacePath),
    workspacePath: args.workspacePath,
    runtimeWorkspacePath: args.runtimeWorkspacePath,
    envWorkspacePath: args.envWorkspacePath,
    outputDir: args.outputDir,
    threadId: DEFAULT_THREAD_ID,
    projectId: DEFAULT_PROJECT_ID,
    turns: args.scenario.turns,
    gitResetRef: args.gitResetRef ?? null,
    runtimeWorkspaceGitStart: args.runtimeWorkspaceGitStart,
    runtimeWorkspaceGitEnd: args.runtimeWorkspaceGitEnd,
  };
}

export function buildBundle(args: {
  manifest: ProviderAuditManifest;
  captures: AgentRuntimeCaptureEntry[];
  clientRequests: ProviderAuditClientRequest[];
  execution?: ProviderAuditScenarioExecutionOptions;
  model?: string;
}): ProviderAuditBundle {
  const rawProviderEvents = args.captures.filter(
    (entry): entry is Extract<
      AgentRuntimeCaptureEntry,
      { kind: "raw-provider-event" }
    > => entry.kind === "raw-provider-event",
  );
  const translatedCaptures = args.captures.filter(
    (entry): entry is Extract<
      AgentRuntimeCaptureEntry,
      { kind: "translated-thread-event" }
    > => entry.kind === "translated-thread-event",
  );
  const toolCallRequests = args.captures.filter(
    (entry): entry is Extract<
      AgentRuntimeCaptureEntry,
      { kind: "tool-call-request" }
    > => entry.kind === "tool-call-request",
  );
  const toolCallResults = args.captures.filter(
    (entry): entry is Extract<
      AgentRuntimeCaptureEntry,
      { kind: "tool-call-result" }
    > => entry.kind === "tool-call-result",
  );
  const providerStderr = args.captures.filter(
    (entry): entry is Extract<
      AgentRuntimeCaptureEntry,
      { kind: "provider-stderr" }
    > => entry.kind === "provider-stderr",
  );
  const processLifecycle = args.captures.filter(
    (
      entry,
    ): entry is Extract<
      AgentRuntimeCaptureEntry,
      { kind: "provider-process-error" | "provider-process-exit" }
    > =>
      entry.kind === "provider-process-error" ||
      entry.kind === "provider-process-exit",
  );
  const threadEvents = translatedCaptures.map((entry) => entry.event);
  const threadEventRows = buildThreadEventRows({
    translatedCaptures,
    clientRequests: args.clientRequests,
    execution: args.execution,
    model: args.model,
  });
  const decodedRows = threadEventRows.map((row) => decodeRow(row));
  const viewMessages = toViewMessages(decodedRows, { threadStatus: "idle" });
  const auditViewMessages = toViewMessages(decodedRows, {
    threadStatus: "idle",
    includeDebugRawEvents: true,
  });
  const timelineRows = buildTimelineRows(viewMessages);
  const timelineText = formatTimelineAsText(viewMessages, {
    verbose: false,
    color: false,
  });
  const timelineVerboseText = formatTimelineAsText(viewMessages, {
    verbose: true,
    color: false,
  });
  const auditReport = buildAuditReport({
    rawProviderEvents,
    translatedCaptures,
    viewMessages,
    auditViewMessages,
    timelineRows,
    toolCallRequests,
    toolCallResults,
    providerStderr,
    processLifecycle,
  });

  return {
    manifest: args.manifest,
    captures: args.captures,
    clientRequests: args.clientRequests,
    rawProviderEvents,
    translatedCaptures,
    toolCallRequests,
    toolCallResults,
    providerStderr,
    processLifecycle,
    threadEvents,
    threadEventRows,
    viewMessages,
    auditViewMessages,
    timelineRows,
    timelineText,
    timelineVerboseText,
    auditReport,
  };
}

export function writeBundle(bundle: ProviderAuditBundle): void {
  mkdirSync(bundle.manifest.outputDir, { recursive: true });
  writeJson(bundle.manifest.outputDir, "manifest.json", bundle.manifest);
  writeJson(bundle.manifest.outputDir, "client-requests.json", bundle.clientRequests);
  writeJson(
    bundle.manifest.outputDir,
    "raw-provider-events.json",
    bundle.rawProviderEvents,
  );
  writeJson(bundle.manifest.outputDir, "thread-events.json", bundle.threadEvents);
  writeJson(
    bundle.manifest.outputDir,
    "thread-event-rows.json",
    bundle.threadEventRows,
  );
  writeJson(bundle.manifest.outputDir, "view-messages.json", bundle.viewMessages);
  writeJson(
    bundle.manifest.outputDir,
    "view-messages.audit.json",
    bundle.auditViewMessages,
  );
  writeJson(bundle.manifest.outputDir, "timeline-rows.json", bundle.timelineRows);
  writeJson(bundle.manifest.outputDir, "audit-report.json", bundle.auditReport);
  writeFileSync(
    join(bundle.manifest.outputDir, "timeline.txt"),
    bundle.timelineText + "\n",
  );
  writeFileSync(
    join(bundle.manifest.outputDir, "timeline.verbose.txt"),
    bundle.timelineVerboseText + "\n",
  );
}

export async function runProviderAuditCapture(
  args: ProviderAuditCliArgs,
): Promise<ProviderAuditRunResult> {
  const scenario = resolveScenario(args);
  const outputDir = args.outputDir ?? defaultOutputDir(args.providerId, args.scenarioId);
  const preparedWorkspace = prepareScenarioWorkspace({
    outputDir,
    scenario,
    workspacePath: args.workspacePath,
  });
  const captures: AgentRuntimeCaptureEntry[] = [];
  const clientRequests: ProviderAuditClientRequest[] = [];
  const translatedCaptures: Extract<
    AgentRuntimeCaptureEntry,
    { kind: "translated-thread-event" }
  >[] = [];
  const toolFixturesByName = buildToolFixturesByName(scenario);
  if (args.gitResetRef) {
    if (scenario.workspaceMode === "scratch") {
      throw new Error(
        "--git-reset-ref can only be used with repo-backed scenarios",
      );
    }
    resetGitWorkspaceToRef(preparedWorkspace.runtimeWorkspacePath, args.gitResetRef);
  }
  const runtimeWorkspaceGitStart = getGitSnapshot(
    preparedWorkspace.runtimeWorkspacePath,
  );
  try {
    const capturedAt = Date.now();
    const runtime = createAgentRuntime({
      workspacePath: preparedWorkspace.runtimeWorkspacePath,
      env: loadDotEnv(preparedWorkspace.envWorkspacePath),
      onEvent: () => {},
      onCapture: (entry) => {
        const clonedEntry = cloneCaptureEntry(entry);
        captures.push(clonedEntry);
        if (clonedEntry.kind === "translated-thread-event") {
          translatedCaptures.push(clonedEntry);
        }
      },
      onToolCall: async (request) => {
        const fixture = toolFixturesByName.get(request.tool);
        if (fixture) {
          return structuredClone(fixture.response);
        }
        return buildDefaultToolResponse(request);
      },
    });
    try {
      await runScenario({
        runtime,
        scenario,
        providerId: args.providerId,
        model: args.model,
        clientRequests,
        translatedCaptures,
        timeoutMs: args.timeoutMs,
      });
    } finally {
      await runtime.shutdown();
    }

    const completedAt = Date.now();
    const runtimeWorkspaceGitEnd = getGitSnapshot(
      preparedWorkspace.runtimeWorkspacePath,
    );
    const manifest = buildManifest({
      providerId: args.providerId,
      scenario,
      model: args.model,
      workspacePath: args.workspacePath,
      runtimeWorkspacePath: preparedWorkspace.runtimeWorkspacePath,
      envWorkspacePath: preparedWorkspace.envWorkspacePath,
      outputDir,
      capturedAt,
      completedAt,
      gitResetRef: args.gitResetRef,
      runtimeWorkspaceGitStart,
      runtimeWorkspaceGitEnd,
    });
    const bundle = buildBundle({
      manifest,
      captures,
      clientRequests,
      execution: scenario.execution,
      model: args.model,
    });
    writeBundle(bundle);
    return {
      outputDir,
      bundle,
    };
  } finally {
    if (args.gitResetRef) {
      resetGitWorkspaceToRef(preparedWorkspace.runtimeWorkspacePath, args.gitResetRef);
    }
  }
}
