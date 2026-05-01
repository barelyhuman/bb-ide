import type { JsonObject, ThreadEventScope } from "@bb/domain";
import type {
  EventProjectionApprovalLifecycleStatus,
  EventProjectionCommandMessage,
  EventProjectionDelegationMessage,
  EventProjectionWebFetchMessage,
  EventProjectionMessage,
  EventProjection,
  EventProjectionToolCallMessage,
  EventProjectionToolParsedIntent,
  EventProjectionWebSearchMessage,
} from "./event-projection-types.js";
import type { EventMeta } from "./event-decode.js";
import type {
  CommandExecutionUpdate,
  DelegationExecutionUpdate,
  ExecutionOutputUpdate,
  ProviderExecutionUpdate,
  ToolCallExecutionUpdate,
} from "./exec-lifecycle.js";
import { messageId } from "./format-helpers.js";
import {
  areThreadEventScopesEqual,
  eventProjectionMessageThreadScopeFields,
  eventProjectionMessageTurnScopeFields,
} from "./message-scope.js";
import {
  appendVisibleTextBuffer,
  createVisibleTextBuffer,
  flushVisibleTextBuffer,
  getVisibleTextBufferFullLength,
  getVisibleTextBufferText,
  setVisibleTextBuffer,
  type VisibleTextBuffer,
} from "./visible-text-buffer.js";
import type { WebActivityLifecycleEvent } from "./web-activity-lifecycle.js";

type ViewProviderExecutionMessage =
  | EventProjectionCommandMessage
  | EventProjectionToolCallMessage
  | EventProjectionDelegationMessage;
type ViewWebActivityMessage =
  | EventProjectionWebSearchMessage
  | EventProjectionWebFetchMessage;
type WebActivityKind = ViewWebActivityMessage["kind"];
type InterruptibleToolMessage =
  | ViewProviderExecutionMessage
  | ViewWebActivityMessage;
type InterruptibleToolCall = Pick<
  ViewProviderExecutionMessage,
  "output" | "status"
>;
interface RunningExecutionBase {
  callId: string;
  threadId: string;
  scope: ThreadEventScope;
  parentToolCallId?: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  startedAt: number;
  output: string;
  durationMs: number | null;
  status: ViewProviderExecutionMessage["status"];
  outputBuffer: VisibleTextBuffer;
}

interface PendingExecutionOutput {
  callId: string;
  parentToolCallId?: string;
  sourceSeqStart: number;
  sourceSeqEnd: number;
  createdAt: number;
  startedAt: number;
  output: string;
  status?: ViewProviderExecutionMessage["status"];
  outputBuffer: VisibleTextBuffer;
}

type BufferedExecutionOutput = RunningExecCall | PendingExecutionOutput;

interface RunningCommandExecution extends RunningExecutionBase {
  kind: "command";
  command: string;
  cwd: string | null;
  parsedIntents: EventProjectionToolParsedIntent[];
  source: string | null;
  exitCode: number | null;
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
}

interface RunningToolCallExecution extends RunningExecutionBase {
  kind: "tool-call";
  toolName: string | null;
  toolArgs: JsonObject | null;
  parsedIntents: EventProjectionToolParsedIntent[];
  approvalStatus: EventProjectionApprovalLifecycleStatus | null;
}

interface RunningDelegationExecution extends RunningExecutionBase {
  kind: "delegation";
  toolName: string | null;
  subagentType?: string;
  description?: string;
}

type RunningExecCall =
  | RunningCommandExecution
  | RunningToolCallExecution
  | RunningDelegationExecution;

type MaybeProviderExecutionMessage =
  | EventProjectionMessage
  | ViewProviderExecutionMessage
  | ViewWebActivityMessage
  | null;

type ApprovalStatusDelta =
  | { kind: "keep" }
  | { kind: "set"; value: EventProjectionApprovalLifecycleStatus | null };

export interface ToolActivityProjectionState {
  messages: EventProjectionMessage[];
  toolActivity: ToolActivityState;
}

export interface ToolActivityState {
  runningCallsById: Map<string, RunningExecCall>;
  pendingOutputsByCallId: Map<string, PendingExecutionOutput>;
  activeCell: ViewProviderExecutionMessage | ViewWebActivityMessage | null;
  historyCells: Array<ViewProviderExecutionMessage | ViewWebActivityMessage>;
  finalizedExecCallIds: Set<string>;
  finalizedWebActivityCallIds: Set<string>;
}

interface MergeCallSummaryOptions {
  appendOutput?: boolean;
  replaceOutput?: boolean;
  visibleOutput?: string;
}

export interface InterruptPendingToolActivityArgs {
  turnIds?: ReadonlySet<string>;
}

export function createToolActivityState(): ToolActivityState {
  return {
    runningCallsById: new Map(),
    pendingOutputsByCallId: new Map(),
    activeCell: null,
    historyCells: [],
    finalizedExecCallIds: new Set(),
    finalizedWebActivityCallIds: new Set(),
  };
}

function emptyEventProjection(): EventProjection {
  return {
    entries: [],
    state: {
      activeThinking: null,
    },
  };
}

function isProviderExecutionMessage(
  message: MaybeProviderExecutionMessage,
): message is ViewProviderExecutionMessage {
  return (
    message?.kind === "command" ||
    message?.kind === "tool-call" ||
    message?.kind === "delegation"
  );
}

function getCallStatusRank(
  status: EventProjectionToolCallMessage["status"] | undefined,
): number {
  if (!status) return 0;
  if (status === "pending") return 1;
  if (status === "interrupted") return 2;
  if (status === "completed") return 3;
  if (status === "error") return 4;
  return 0;
}

function mergeCallStatus(
  current: EventProjectionToolCallMessage["status"] | undefined,
  incoming: EventProjectionToolCallMessage["status"] | undefined,
): EventProjectionToolCallMessage["status"] | undefined {
  if (!incoming) return current;
  if (!current) return incoming;
  return getCallStatusRank(incoming) >= getCallStatusRank(current)
    ? incoming
    : current;
}

export function buildApprovalStatusDelta(
  incoming: EventProjectionApprovalLifecycleStatus | null | undefined,
  incomingStatus: EventProjectionToolCallMessage["status"] | undefined,
): ApprovalStatusDelta {
  if (incoming !== undefined) {
    return { kind: "set", value: incoming };
  }
  if (incomingStatus !== undefined) {
    return { kind: "set", value: null };
  }
  return { kind: "keep" };
}

export function applyApprovalStatusDelta(
  current: EventProjectionApprovalLifecycleStatus | null,
  delta: ApprovalStatusDelta,
): EventProjectionApprovalLifecycleStatus | null {
  switch (delta.kind) {
    case "keep":
      return current;
    case "set":
      return delta.value;
  }
}

function hasSemanticIntent(
  intents: EventProjectionToolParsedIntent[],
): boolean {
  return intents.some((intent) => intent.type !== "unknown");
}

function chooseParsedIntents(
  existing: EventProjectionToolParsedIntent[],
  incoming: EventProjectionToolParsedIntent[],
): EventProjectionToolParsedIntent[] {
  if (incoming.length === 0) return existing;
  if (existing.length === 0) return incoming;
  if (!hasSemanticIntent(existing) && hasSemanticIntent(incoming)) {
    return incoming;
  }
  if (incoming.length > existing.length) return incoming;
  return existing;
}

function isTerminalToolCallStatus(
  status: EventProjectionToolCallMessage["status"] | undefined,
): boolean {
  return status !== undefined && status !== "pending";
}

function syncBufferedExecutionOutput(target: BufferedExecutionOutput): void {
  target.output = getVisibleTextBufferText(target.outputBuffer) ?? "";
}

function syncRunningCallVisibleOutput(call: RunningExecCall): void {
  call.output = getVisibleTextBufferText(call.outputBuffer) ?? "";
}

function setBufferedExecutionOutput(
  target: BufferedExecutionOutput,
  text: string,
  flushTrailingPartial: boolean,
): void {
  setVisibleTextBuffer(target.outputBuffer, text, flushTrailingPartial);
  syncBufferedExecutionOutput(target);
}

function setRunningCallOutput(
  call: RunningExecCall,
  text: string,
  flushTrailingPartial: boolean,
): void {
  setBufferedExecutionOutput(call, text, flushTrailingPartial);
}

interface CreateRunningExecutionBaseArgs {
  incoming: ProviderExecutionUpdate;
  meta: EventMeta;
  scope: ThreadEventScope;
  threadId: string;
}

function createRunningExecutionBase({
  incoming,
  meta,
  scope,
  threadId,
}: CreateRunningExecutionBaseArgs): RunningExecutionBase {
  const outputBuffer = createVisibleTextBuffer();
  if (incoming.output && incoming.output.length > 0) {
    setVisibleTextBuffer(
      outputBuffer,
      incoming.output,
      isTerminalToolCallStatus(incoming.status),
    );
  }

  return {
    callId: incoming.callId,
    threadId,
    scope,
    ...(incoming.parentToolCallId
      ? { parentToolCallId: incoming.parentToolCallId }
      : {}),
    output: getVisibleTextBufferText(outputBuffer) ?? "",
    durationMs: incoming.durationMs ?? null,
    status: incoming.status ?? "pending",
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    outputBuffer,
  };
}

function createRunningExecCall(
  incoming: ProviderExecutionUpdate,
  meta: EventMeta,
  threadId: string,
  scope: ThreadEventScope,
): RunningExecCall {
  const base = createRunningExecutionBase({
    incoming,
    meta,
    scope,
    threadId,
  });

  switch (incoming.kind) {
    case "command":
      return {
        ...base,
        kind: "command",
        command: incoming.command ?? "",
        cwd: incoming.cwd ?? null,
        parsedIntents: incoming.parsedIntents ?? [],
        source: incoming.source ?? null,
        exitCode: incoming.exitCode ?? null,
        approvalStatus: incoming.approvalStatus ?? null,
      };
    case "tool-call":
      return {
        ...base,
        kind: "tool-call",
        toolName: incoming.toolName ?? null,
        toolArgs: incoming.toolArgs ?? null,
        parsedIntents: incoming.parsedIntents ?? [],
        approvalStatus: incoming.approvalStatus ?? null,
      };
    case "delegation":
      return {
        ...base,
        kind: "delegation",
        toolName: incoming.toolName ?? null,
        subagentType: incoming.subagentType,
        description: incoming.description,
      };
  }
}

function assertMatchingExecutionKind(
  existing: RunningExecCall,
  incoming: ProviderExecutionUpdate,
): void {
  if (existing.kind === incoming.kind) {
    return;
  }

  throw new Error(
    `Cannot merge ${existing.kind} with ${incoming.kind} for call ${incoming.callId}`,
  );
}

function mergeCommandExecutionMetadata(
  existing: RunningCommandExecution,
  incoming: CommandExecutionUpdate,
): void {
  if (incoming.cwd && !existing.cwd) existing.cwd = incoming.cwd;
  if (incoming.source && !existing.source) existing.source = incoming.source;
  if (incoming.command && incoming.command.length > existing.command.length) {
    existing.command = incoming.command;
  }
  existing.parsedIntents = chooseParsedIntents(
    existing.parsedIntents,
    incoming.parsedIntents ?? [],
  );
  if (incoming.exitCode !== undefined) existing.exitCode = incoming.exitCode;
  existing.approvalStatus = applyApprovalStatusDelta(
    existing.approvalStatus,
    buildApprovalStatusDelta(incoming.approvalStatus, incoming.status),
  );
}

function mergeToolCallExecutionMetadata(
  existing: RunningToolCallExecution,
  incoming: ToolCallExecutionUpdate,
): void {
  if (incoming.toolName && !existing.toolName) {
    existing.toolName = incoming.toolName;
  }
  if (incoming.toolArgs && !existing.toolArgs) {
    existing.toolArgs = incoming.toolArgs;
  }
  existing.parsedIntents = chooseParsedIntents(
    existing.parsedIntents,
    incoming.parsedIntents ?? [],
  );
  existing.approvalStatus = applyApprovalStatusDelta(
    existing.approvalStatus,
    buildApprovalStatusDelta(incoming.approvalStatus, incoming.status),
  );
}

function mergeDelegationExecutionMetadata(
  existing: RunningDelegationExecution,
  incoming: DelegationExecutionUpdate,
): void {
  if (incoming.toolName && !existing.toolName) {
    existing.toolName = incoming.toolName;
  }
  if (incoming.subagentType && !existing.subagentType) {
    existing.subagentType = incoming.subagentType;
  }
  if (incoming.description && !existing.description) {
    existing.description = incoming.description;
  }
}

function mergeRunningExecutionMetadata(
  existing: RunningExecCall,
  incoming: ProviderExecutionUpdate,
): void {
  assertMatchingExecutionKind(existing, incoming);
  switch (incoming.kind) {
    case "command":
      if (existing.kind !== "command") return;
      mergeCommandExecutionMetadata(existing, incoming);
      return;
    case "tool-call":
      if (existing.kind !== "tool-call") return;
      mergeToolCallExecutionMetadata(existing, incoming);
      return;
    case "delegation":
      if (existing.kind !== "delegation") return;
      mergeDelegationExecutionMetadata(existing, incoming);
      return;
  }
}

function upsertRunningExecCall(
  existing: RunningExecCall | undefined,
  incoming: ProviderExecutionUpdate,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
): RunningExecCall {
  const scopeFields = turnId
    ? eventProjectionMessageTurnScopeFields(turnId)
    : eventProjectionMessageThreadScopeFields();
  if (!existing) {
    return createRunningExecCall(incoming, meta, threadId, scopeFields.scope);
  }

  // Merge strategy per field:
  //   "keep first"  — set once from the first event that provides it
  //   "keep longest" — begin events carry partial info, end events carry full info
  //   "keep latest"  — terminal state from the last event wins

  // keep first
  if (!areThreadEventScopesEqual(existing.scope, scopeFields.scope)) {
    throw new Error(
      `Cannot merge execution messages with different scopes for call ${incoming.callId}`,
    );
  }
  mergeRunningExecutionMetadata(existing, incoming);
  if (incoming.durationMs !== undefined && existing.durationMs === null) {
    existing.durationMs = incoming.durationMs;
  }
  if (!existing.parentToolCallId && incoming.parentToolCallId) {
    existing.parentToolCallId = incoming.parentToolCallId;
  }

  // keep longest (begin has partial, end has full)
  if (incoming.output && incoming.output.length > 0) {
    if (
      isTerminalToolCallStatus(incoming.status) ||
      incoming.output.length >=
        getVisibleTextBufferFullLength(existing.outputBuffer)
    ) {
      setRunningCallOutput(
        existing,
        incoming.output,
        isTerminalToolCallStatus(incoming.status),
      );
    }
  }

  // keep latest
  existing.threadId = threadId;
  existing.status =
    mergeCallStatus(existing.status, incoming.status) ?? "pending";
  existing.sourceSeqEnd = Math.max(existing.sourceSeqEnd, meta.seq);
  existing.createdAt = Math.max(existing.createdAt, meta.createdAt);

  return existing;
}

function appendExecOutputDelta(
  target: BufferedExecutionOutput,
  delta: string | undefined,
): void {
  if (!delta || delta.length === 0) return;
  appendVisibleTextBuffer(target.outputBuffer, delta);
  syncBufferedExecutionOutput(target);
}

function applyExecutionOutputUpdate(
  target: BufferedExecutionOutput,
  incoming: ExecutionOutputUpdate,
  appendOutput?: boolean,
  replaceOutput?: boolean,
): void {
  if (appendOutput) {
    appendExecOutputDelta(target, incoming.output);
    return;
  }
  if (replaceOutput) {
    setBufferedExecutionOutput(
      target,
      incoming.output,
      isTerminalToolCallStatus(incoming.status),
    );
    return;
  }
  if (
    incoming.output.length >=
    getVisibleTextBufferFullLength(target.outputBuffer)
  ) {
    setBufferedExecutionOutput(target, incoming.output, true);
  }
}

function upsertPendingExecutionOutput(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  incoming: ExecutionOutputUpdate,
  appendOutput?: boolean,
  replaceOutput?: boolean,
): void {
  let pending = state.toolActivity.pendingOutputsByCallId.get(incoming.callId);
  if (!pending) {
    pending = {
      callId: incoming.callId,
      ...(incoming.parentToolCallId
        ? { parentToolCallId: incoming.parentToolCallId }
        : {}),
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      output: "",
      status: incoming.status,
      outputBuffer: createVisibleTextBuffer(),
    };
    state.toolActivity.pendingOutputsByCallId.set(incoming.callId, pending);
  }

  applyExecutionOutputUpdate(pending, incoming, appendOutput, replaceOutput);
  pending.sourceSeqEnd = Math.max(pending.sourceSeqEnd, meta.seq);
  pending.createdAt = Math.max(pending.createdAt, meta.createdAt);
  if (!pending.parentToolCallId && incoming.parentToolCallId) {
    pending.parentToolCallId = incoming.parentToolCallId;
  }
  pending.status = mergeCallStatus(pending.status, incoming.status);
}

function applyPendingExecutionOutput(
  state: ToolActivityProjectionState,
  call: RunningExecCall,
): void {
  const pending = state.toolActivity.pendingOutputsByCallId.get(call.callId);
  if (!pending) {
    return;
  }

  if (isTerminalToolCallStatus(call.status)) {
    flushVisibleTextBuffer(pending.outputBuffer);
    syncBufferedExecutionOutput(pending);
  }
  if (
    getVisibleTextBufferFullLength(pending.outputBuffer) >
    getVisibleTextBufferFullLength(call.outputBuffer)
  ) {
    call.outputBuffer = pending.outputBuffer;
    syncRunningCallVisibleOutput(call);
  }
  call.sourceSeqStart = Math.min(call.sourceSeqStart, pending.sourceSeqStart);
  call.sourceSeqEnd = Math.max(call.sourceSeqEnd, pending.sourceSeqEnd);
  call.startedAt = Math.min(call.startedAt, pending.startedAt);
  call.createdAt = Math.max(call.createdAt, pending.createdAt);
  if (!call.parentToolCallId && pending.parentToolCallId) {
    call.parentToolCallId = pending.parentToolCallId;
  }
  call.status = mergeCallStatus(call.status, pending.status) ?? call.status;
  state.toolActivity.pendingOutputsByCallId.delete(call.callId);
}

function shouldInterruptToolScope(
  scope: ThreadEventScope,
  args: InterruptPendingToolActivityArgs,
): boolean {
  return (
    args.turnIds === undefined ||
    (scope.kind === "turn" && args.turnIds.has(scope.turnId))
  );
}

function interruptPendingToolCall(call: InterruptibleToolCall): void {
  if (call.status !== "pending") {
    return;
  }
  call.status = "interrupted";
  if (!call.output) {
    call.output = "Tool execution interrupted";
  }
}

function interruptPendingToolMessage(message: InterruptibleToolMessage): void {
  switch (message.kind) {
    case "command":
    case "tool-call":
    case "delegation":
      interruptPendingToolCall(message);
      return;
    case "web-search":
    case "web-fetch":
      if (message.status === "pending") {
        message.status = "interrupted";
      }
      return;
  }
}

function isInterruptibleToolMessage(
  message: EventProjectionMessage,
): message is InterruptibleToolMessage {
  return (
    isProviderExecutionMessage(message) ||
    message.kind === "web-search" ||
    message.kind === "web-fetch"
  );
}

function findExecMessageInActiveCell(
  activeCell: ToolActivityState["activeCell"],
  callId: string,
): ViewProviderExecutionMessage | null {
  if (!activeCell) return null;
  if (isProviderExecutionMessage(activeCell) && activeCell.callId === callId) {
    return activeCell;
  }
  return null;
}

function findExecMessageInHistoryCells(
  state: ToolActivityProjectionState,
  callId: string,
): {
  cell: ViewProviderExecutionMessage;
  call: ViewProviderExecutionMessage;
} | null {
  for (
    let index = state.toolActivity.historyCells.length - 1;
    index >= 0;
    index -= 1
  ) {
    const cell = state.toolActivity.historyCells[index];
    if (!cell || cell.kind === "web-search" || cell.kind === "web-fetch") {
      continue;
    }

    const call = findExecMessageInActiveCell(cell, callId);
    if (!call) continue;

    return {
      cell,
      call,
    };
  }

  return null;
}

function isWebActivityMessage(
  cell:
    | ViewProviderExecutionMessage
    | ViewWebActivityMessage
    | null
    | undefined,
): cell is ViewWebActivityMessage {
  return cell?.kind === "web-search" || cell?.kind === "web-fetch";
}

interface FindWebActivityInHistoryCellsArgs {
  callId: string;
  itemKind?: WebActivityKind;
}

function findWebActivityInHistoryCells(
  state: ToolActivityProjectionState,
  args: FindWebActivityInHistoryCellsArgs,
): ViewWebActivityMessage | null {
  for (
    let index = state.toolActivity.historyCells.length - 1;
    index >= 0;
    index -= 1
  ) {
    const cell = state.toolActivity.historyCells[index];
    if (!isWebActivityMessage(cell)) continue;
    if (cell.callId !== args.callId) continue;
    if (args.itemKind && cell.kind !== args.itemKind) continue;
    return cell;
  }

  return null;
}

function buildWebActivityKey(kind: WebActivityKind, callId: string): string {
  return `${kind}:${callId}`;
}

function interruptWebActivityMessage(message: ViewWebActivityMessage): void {
  if (message.status === "pending") {
    message.status = "interrupted";
  }
}

type ExecutionMergeTarget = RunningExecCall | ViewProviderExecutionMessage;
type ExecutionMergeSource =
  | RunningExecCall
  | ProviderExecutionUpdate
  | ExecutionOutputUpdate;
type CommandExecutionMergeTarget =
  | RunningCommandExecution
  | EventProjectionCommandMessage;
type ToolCallExecutionMergeTarget =
  | RunningToolCallExecution
  | EventProjectionToolCallMessage;
type DelegationExecutionMergeTarget =
  | RunningDelegationExecution
  | EventProjectionDelegationMessage;
type CommandExecutionMergeSource =
  | RunningCommandExecution
  | CommandExecutionUpdate;
type ToolCallExecutionMergeSource =
  | RunningToolCallExecution
  | ToolCallExecutionUpdate;
type DelegationExecutionMergeSource =
  | RunningDelegationExecution
  | DelegationExecutionUpdate;

function mergeExecutionOutput(
  target: ExecutionMergeTarget,
  incoming: ExecutionMergeSource,
  options: MergeCallSummaryOptions,
): void {
  const { appendOutput, replaceOutput, visibleOutput } = options;
  if (visibleOutput !== undefined) {
    target.output = visibleOutput;
  } else if (appendOutput && incoming.output && incoming.output.length > 0) {
    target.output = `${target.output}${incoming.output}`;
  } else if (replaceOutput && incoming.output && incoming.output.length > 0) {
    target.output = incoming.output;
  } else if (
    !appendOutput &&
    incoming.output &&
    incoming.output.length > 0 &&
    incoming.output.length >= target.output.length
  ) {
    target.output = incoming.output;
  }
}

function mergeCommandExecutionSummary(
  target: CommandExecutionMergeTarget,
  incoming: CommandExecutionMergeSource,
): void {
  if (incoming.command && incoming.command.length > target.command.length) {
    target.command = incoming.command;
  }
  if (incoming.cwd && !target.cwd) target.cwd = incoming.cwd;
  if (incoming.source && !target.source) target.source = incoming.source;
  target.parsedIntents = chooseParsedIntents(
    target.parsedIntents,
    incoming.parsedIntents ?? [],
  );
  if (incoming.exitCode !== undefined) {
    target.exitCode = incoming.exitCode;
  }
  target.approvalStatus = applyApprovalStatusDelta(
    target.approvalStatus,
    buildApprovalStatusDelta(incoming.approvalStatus, incoming.status),
  );
}

function mergeToolCallExecutionSummary(
  target: ToolCallExecutionMergeTarget,
  incoming: ToolCallExecutionMergeSource,
): void {
  if (incoming.toolName && !target.toolName) {
    target.toolName = incoming.toolName;
  }
  if (incoming.toolArgs && !target.toolArgs) {
    target.toolArgs = incoming.toolArgs;
  }
  target.parsedIntents = chooseParsedIntents(
    target.parsedIntents,
    incoming.parsedIntents ?? [],
  );
  target.approvalStatus = applyApprovalStatusDelta(
    target.approvalStatus,
    buildApprovalStatusDelta(incoming.approvalStatus, incoming.status),
  );
}

function mergeDelegationExecutionSummary(
  target: DelegationExecutionMergeTarget,
  incoming: DelegationExecutionMergeSource,
): void {
  if (incoming.toolName && !target.toolName) {
    target.toolName = incoming.toolName;
  }
  if (incoming.subagentType && !target.subagentType) {
    target.subagentType = incoming.subagentType;
  }
  if (incoming.description && !target.description) {
    target.description = incoming.description;
  }
}

function mergeExecutionSummary(
  target: ExecutionMergeTarget,
  incoming: ExecutionMergeSource,
  options: MergeCallSummaryOptions = {},
): void {
  mergeExecutionOutput(target, incoming, options);
  if ("kind" in incoming) {
    if (target.kind !== incoming.kind) {
      throw new Error(
        `Cannot merge ${target.kind} with ${incoming.kind} for call ${incoming.callId}`,
      );
    }
    switch (incoming.kind) {
      case "command":
        if (target.kind !== "command") return;
        mergeCommandExecutionSummary(target, incoming);
        break;
      case "tool-call":
        if (target.kind !== "tool-call") return;
        mergeToolCallExecutionSummary(target, incoming);
        break;
      case "delegation":
        if (target.kind !== "delegation") return;
        mergeDelegationExecutionSummary(target, incoming);
        break;
    }
    if (incoming.durationMs !== undefined && target.durationMs === null) {
      target.durationMs = incoming.durationMs;
    }
  }
  target.status =
    mergeCallStatus(target.status, incoming.status) ?? target.status;
}

function syncProjectedCallOutput(
  state: ToolActivityProjectionState,
  call: RunningExecCall,
): void {
  const activeCall = findExecMessageInActiveCell(
    state.toolActivity.activeCell,
    call.callId,
  );
  if (activeCall) {
    activeCall.output = call.output;
  }

  const historyMatch = findExecMessageInHistoryCells(state, call.callId);
  if (historyMatch) {
    historyMatch.call.output = call.output;
  }
}

export function flushActiveToolCell(state: ToolActivityProjectionState): void {
  const active = state.toolActivity.activeCell;
  if (!active) return;

  if (isProviderExecutionMessage(active) && active.status !== "pending") {
    state.toolActivity.finalizedExecCallIds.add(active.callId);
  }

  state.toolActivity.historyCells.push(active);
  state.messages.push(active);
  state.toolActivity.activeCell = null;
}

export function flushToolActivityBeforeNonToolMessage(
  state: ToolActivityProjectionState,
): void {
  flushActiveToolCell(state);
}

export function flushPendingToolActivityOutput(
  state: ToolActivityProjectionState,
): void {
  for (const call of state.toolActivity.runningCallsById.values()) {
    if (!flushVisibleTextBuffer(call.outputBuffer)) {
      continue;
    }
    syncRunningCallVisibleOutput(call);
    syncProjectedCallOutput(state, call);
  }
}

export function interruptPendingToolActivity(
  state: ToolActivityProjectionState,
  args: InterruptPendingToolActivityArgs = {},
): void {
  const interruptedRunningCallIds: string[] = [];
  for (const call of state.toolActivity.runningCallsById.values()) {
    if (!shouldInterruptToolScope(call.scope, args)) {
      continue;
    }

    flushVisibleTextBuffer(call.outputBuffer);
    syncRunningCallVisibleOutput(call);
    interruptPendingToolCall(call);

    const activeCall = findExecMessageInActiveCell(
      state.toolActivity.activeCell,
      call.callId,
    );
    if (activeCall) {
      mergeExecutionSummary(activeCall, call);
      interruptedRunningCallIds.push(call.callId);
      continue;
    }

    const historyMatch = findExecMessageInHistoryCells(state, call.callId);
    if (historyMatch) {
      mergeExecutionSummary(historyMatch.call, call);
      interruptedRunningCallIds.push(call.callId);
      continue;
    }

    state.messages.push(createExecMessage(call));
    interruptedRunningCallIds.push(call.callId);
  }

  for (const callId of interruptedRunningCallIds) {
    state.toolActivity.runningCallsById.delete(callId);
  }

  if (
    state.toolActivity.activeCell &&
    shouldInterruptToolScope(state.toolActivity.activeCell.scope, args)
  ) {
    interruptPendingToolMessage(state.toolActivity.activeCell);
  }

  for (const cell of state.toolActivity.historyCells) {
    if (shouldInterruptToolScope(cell.scope, args)) {
      interruptPendingToolMessage(cell);
    }
  }

  for (const message of state.messages) {
    if (
      isInterruptibleToolMessage(message) &&
      shouldInterruptToolScope(message.scope, args)
    ) {
      interruptPendingToolMessage(message);
    }
  }
}

function createExecMessage(
  call: RunningExecCall,
): ViewProviderExecutionMessage {
  const rowKindForId = call.kind === "tool-call" ? "tool" : call.kind;
  const base = {
    id: messageId(call.threadId, rowKindForId, call.callId),
    threadId: call.threadId,
    sourceSeqStart: call.sourceSeqStart,
    sourceSeqEnd: call.sourceSeqEnd,
    createdAt: call.createdAt,
    startedAt: call.startedAt,
    scope: call.scope,
    ...(call.parentToolCallId
      ? { parentToolCallId: call.parentToolCallId }
      : {}),
    callId: call.callId,
    output: call.output,
    durationMs: call.durationMs,
    status: call.status,
  };

  if (call.kind === "command") {
    return {
      ...base,
      kind: "command",
      command: call.command,
      cwd: call.cwd,
      parsedIntents: call.parsedIntents,
      source: call.source,
      exitCode: call.exitCode,
      approvalStatus: call.approvalStatus,
    };
  }

  if (call.kind === "delegation") {
    return {
      ...base,
      kind: "delegation",
      toolName: call.toolName ?? "Agent",
      subagentType: call.subagentType,
      description: call.description,
      childProjection: emptyEventProjection(),
    };
  }

  return {
    ...base,
    kind: "tool-call",
    toolName: call.toolName ?? "tool",
    toolArgs: call.toolArgs,
    parsedIntents: call.parsedIntents,
    approvalStatus: call.approvalStatus,
  };
}

export function onExecBegin(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  incoming: ProviderExecutionUpdate,
): void {
  const existingRunning = state.toolActivity.runningCallsById.get(
    incoming.callId,
  );
  const call = upsertRunningExecCall(
    existingRunning,
    incoming,
    meta,
    threadId,
    turnId,
  );
  applyPendingExecutionOutput(state, call);
  state.toolActivity.runningCallsById.set(call.callId, call);

  const existingInActive = findExecMessageInActiveCell(
    state.toolActivity.activeCell,
    call.callId,
  );
  if (existingInActive) {
    mergeExecutionSummary(existingInActive, call);
    if (isProviderExecutionMessage(state.toolActivity.activeCell)) {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        call.sourceSeqEnd,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        call.createdAt,
      );
    }
    return;
  }

  flushActiveToolCell(state);
  state.toolActivity.activeCell = createExecMessage(call);
}

export function onExecOutput(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  incoming: ExecutionOutputUpdate,
  appendOutput?: boolean,
  replaceOutput?: boolean,
): void {
  const existingRunning = state.toolActivity.runningCallsById.get(
    incoming.callId,
  );
  if (existingRunning) {
    applyExecutionOutputUpdate(
      existingRunning,
      incoming,
      appendOutput,
      replaceOutput,
    );
    mergeExecutionSummary(existingRunning, incoming, {
      appendOutput,
      replaceOutput,
      visibleOutput: existingRunning.output,
    });
    existingRunning.sourceSeqEnd = Math.max(
      existingRunning.sourceSeqEnd,
      meta.seq,
    );
    existingRunning.createdAt = Math.max(
      existingRunning.createdAt,
      meta.createdAt,
    );
  }

  const activeCall = findExecMessageInActiveCell(
    state.toolActivity.activeCell,
    incoming.callId,
  );
  if (activeCall) {
    mergeExecutionSummary(activeCall, incoming, {
      appendOutput,
      replaceOutput,
      visibleOutput: existingRunning?.output,
    });
    if (isProviderExecutionMessage(state.toolActivity.activeCell)) {
      state.toolActivity.activeCell.sourceSeqEnd = Math.max(
        state.toolActivity.activeCell.sourceSeqEnd,
        meta.seq,
      );
      state.toolActivity.activeCell.createdAt = Math.max(
        state.toolActivity.activeCell.createdAt,
        meta.createdAt,
      );
    }
  }

  const historyMatch = findExecMessageInHistoryCells(state, incoming.callId);
  if (!historyMatch) {
    if (!existingRunning && !activeCall) {
      upsertPendingExecutionOutput(
        state,
        meta,
        incoming,
        appendOutput,
        replaceOutput,
      );
    }
    return;
  }

  mergeExecutionSummary(historyMatch.call, incoming, {
    appendOutput,
    replaceOutput,
    visibleOutput: existingRunning?.output,
  });
  historyMatch.cell.sourceSeqEnd = Math.max(
    historyMatch.cell.sourceSeqEnd,
    meta.seq,
  );
  historyMatch.cell.createdAt = Math.max(
    historyMatch.cell.createdAt,
    meta.createdAt,
  );

  historyMatch.cell.status =
    mergeCallStatus(historyMatch.cell.status, incoming.status) ??
    historyMatch.cell.status;
}

export function onExecEnd(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  incoming: ProviderExecutionUpdate,
): void {
  const running = state.toolActivity.runningCallsById.get(incoming.callId);
  const merged = upsertRunningExecCall(
    running,
    incoming,
    meta,
    threadId,
    turnId,
  );
  applyPendingExecutionOutput(state, merged);
  if (isTerminalToolCallStatus(merged.status)) {
    flushVisibleTextBuffer(merged.outputBuffer);
    syncRunningCallVisibleOutput(merged);
  }
  state.toolActivity.runningCallsById.delete(incoming.callId);

  const active = state.toolActivity.activeCell;
  const existingInActive = findExecMessageInActiveCell(active, incoming.callId);
  if (existingInActive) {
    mergeExecutionSummary(existingInActive, merged, {
      visibleOutput: merged.output,
    });
    if (isProviderExecutionMessage(active)) {
      active.sourceSeqEnd = Math.max(active.sourceSeqEnd, merged.sourceSeqEnd);
      active.createdAt = Math.max(active.createdAt, merged.createdAt);
      active.status =
        mergeCallStatus(active.status, merged.status) ?? active.status;
      active.output = merged.output || active.output;
      active.durationMs = merged.durationMs ?? active.durationMs;
      state.toolActivity.finalizedExecCallIds.add(incoming.callId);
      flushActiveToolCell(state);
      return;
    }
  }

  if (state.toolActivity.finalizedExecCallIds.has(incoming.callId)) {
    return;
  }

  const historyMatch = findExecMessageInHistoryCells(state, incoming.callId);
  if (historyMatch) {
    mergeExecutionSummary(historyMatch.call, merged, {
      visibleOutput: merged.output,
    });
    historyMatch.cell.sourceSeqEnd = Math.max(
      historyMatch.cell.sourceSeqEnd,
      merged.sourceSeqEnd,
    );
    historyMatch.cell.createdAt = Math.max(
      historyMatch.cell.createdAt,
      merged.createdAt,
    );

    historyMatch.cell.status =
      mergeCallStatus(historyMatch.cell.status, merged.status) ??
      historyMatch.cell.status;
    historyMatch.cell.output = merged.output || historyMatch.cell.output;
    historyMatch.cell.durationMs =
      merged.durationMs ?? historyMatch.cell.durationMs;

    state.toolActivity.finalizedExecCallIds.add(incoming.callId);
    return;
  }

  flushActiveToolCell(state);

  const execMessage = createExecMessage(merged);
  execMessage.status =
    mergeCallStatus(execMessage.status, incoming.status) ?? execMessage.status;
  state.toolActivity.activeCell = execMessage;
  flushActiveToolCell(state);
}

function createWebActivityMessage(
  threadId: string,
  meta: EventMeta,
  turnId: string | undefined,
  payload: WebActivityLifecycleEvent,
  status: ViewWebActivityMessage["status"],
): ViewWebActivityMessage {
  if (payload.itemKind === "web-search") {
    return {
      kind: "web-search",
      id: messageId(threadId, "web-search", payload.callId),
      threadId,
      sourceSeqStart: meta.seq,
      sourceSeqEnd: meta.seq,
      createdAt: meta.createdAt,
      startedAt: meta.createdAt,
      ...(turnId
        ? eventProjectionMessageTurnScopeFields(turnId)
        : eventProjectionMessageThreadScopeFields()),
      ...(payload.parentToolCallId
        ? { parentToolCallId: payload.parentToolCallId }
        : {}),
      callId: payload.callId,
      queries: payload.queries,
      resultText: payload.resultText,
      status,
    };
  }

  return {
    kind: "web-fetch",
    id: messageId(threadId, "web-fetch", payload.callId),
    threadId,
    sourceSeqStart: meta.seq,
    sourceSeqEnd: meta.seq,
    createdAt: meta.createdAt,
    startedAt: meta.createdAt,
    ...(turnId
      ? eventProjectionMessageTurnScopeFields(turnId)
      : eventProjectionMessageThreadScopeFields()),
    ...(payload.parentToolCallId
      ? { parentToolCallId: payload.parentToolCallId }
      : {}),
    callId: payload.callId,
    url: payload.url,
    prompt: payload.prompt,
    pattern: payload.pattern,
    resultText: payload.resultText,
    status,
  };
}

function mergeWebActivityMessage(
  target: ViewWebActivityMessage,
  meta: EventMeta,
  turnId: string | undefined,
  payload: WebActivityLifecycleEvent,
): void {
  const scopeFields = turnId
    ? eventProjectionMessageTurnScopeFields(turnId)
    : eventProjectionMessageThreadScopeFields();
  if (!areThreadEventScopesEqual(target.scope, scopeFields.scope)) {
    throw new Error(
      `Cannot merge ${target.kind} messages with different scopes for call ${payload.callId}`,
    );
  }
  target.sourceSeqEnd = Math.max(target.sourceSeqEnd, meta.seq);
  target.createdAt = Math.max(target.createdAt, meta.createdAt);
  if (!target.parentToolCallId && payload.parentToolCallId) {
    target.parentToolCallId = payload.parentToolCallId;
  }

  if (target.kind === "web-search" && payload.itemKind === "web-search") {
    target.queries = payload.queries;
    target.resultText = payload.resultText;
    return;
  }

  if (target.kind === "web-fetch" && payload.itemKind === "web-fetch") {
    target.url = payload.url;
    target.prompt = payload.prompt;
    target.pattern = payload.pattern;
    target.resultText = payload.resultText;
  }
}

export function onWebActivityBegin(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: WebActivityLifecycleEvent,
): void {
  const activityKey = buildWebActivityKey(payload.itemKind, payload.callId);
  if (state.toolActivity.finalizedWebActivityCallIds.has(activityKey)) {
    return;
  }

  const active = state.toolActivity.activeCell;
  if (
    isWebActivityMessage(active) &&
    active.callId === payload.callId &&
    active.kind !== payload.itemKind
  ) {
    interruptWebActivityMessage(active);
    flushActiveToolCell(state);
  }

  if (
    active &&
    active.kind === payload.itemKind &&
    active.callId === payload.callId
  ) {
    mergeWebActivityMessage(active, meta, turnId, payload);
    return;
  }

  flushActiveToolCell(state);
  state.toolActivity.activeCell = createWebActivityMessage(
    threadId,
    meta,
    turnId,
    payload,
    "pending",
  );
}

export function onWebActivityEnd(
  state: ToolActivityProjectionState,
  meta: EventMeta,
  threadId: string,
  turnId: string | undefined,
  payload: WebActivityLifecycleEvent,
): void {
  const activityKey = buildWebActivityKey(payload.itemKind, payload.callId);
  if (state.toolActivity.finalizedWebActivityCallIds.has(activityKey)) {
    return;
  }

  const active = state.toolActivity.activeCell;
  if (
    isWebActivityMessage(active) &&
    active.callId === payload.callId &&
    active.kind !== payload.itemKind
  ) {
    interruptWebActivityMessage(active);
    flushActiveToolCell(state);
  }

  if (
    active &&
    active.kind === payload.itemKind &&
    active.callId === payload.callId
  ) {
    mergeWebActivityMessage(active, meta, turnId, payload);
    active.status = "completed";
    flushActiveToolCell(state);
    state.toolActivity.finalizedWebActivityCallIds.add(activityKey);
    return;
  }

  flushActiveToolCell(state);

  const conflictingHistoryMatch = findWebActivityInHistoryCells(state, {
    callId: payload.callId,
  });
  if (
    conflictingHistoryMatch &&
    conflictingHistoryMatch.kind !== payload.itemKind
  ) {
    interruptWebActivityMessage(conflictingHistoryMatch);
  }

  const historyMatch = findWebActivityInHistoryCells(state, {
    callId: payload.callId,
    itemKind: payload.itemKind,
  });
  if (historyMatch) {
    mergeWebActivityMessage(historyMatch, meta, turnId, payload);
    historyMatch.status = "completed";
    state.toolActivity.finalizedWebActivityCallIds.add(activityKey);
    return;
  }

  const completedMessage = createWebActivityMessage(
    threadId,
    meta,
    turnId,
    payload,
    "completed",
  );
  completedMessage.id = messageId(
    threadId,
    completedMessage.kind,
    `${payload.callId}:${meta.seq}`,
  );
  state.messages.push(completedMessage);
  state.toolActivity.finalizedWebActivityCallIds.add(activityKey);
}
