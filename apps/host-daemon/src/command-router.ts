import type {
  HostDaemonCommand,
  HostDaemonCommandEnvelope,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
  HostDaemonOnlineRpcResultForCommand,
  HostDaemonOnlineRpcCommand,
  HostDaemonCommandResult,
  HostDaemonCommandResultReport,
  HostDaemonCommandResultReportWithoutSession,
} from "@bb/host-daemon-contract";
import { performance } from "node:perf_hooks";
import {
  hostDaemonCommandResultReportSchema,
  hostDaemonOnlineRpcResponseMessageSchema,
  parseHostDaemonOnlineRpcResultForCommand,
  shouldFlushEventsBeforeReportingCommandResult,
} from "@bb/host-daemon-contract";
import {
  dispatchCommand,
  dispatchOnlineRpcCommand,
  getErrorCode,
  type CommandDispatchOptions,
} from "./command-dispatch.js";
import { isExpectedCommandDispatchError } from "./command-dispatch-support.js";
import type { HostDaemonLogger } from "./logger.js";
import { RuntimeManager } from "./runtime-manager.js";
import { runtimeErrorLogFields } from "./error-utils.js";

type CommandResultReport = HostDaemonCommandResultReportWithoutSession;

interface CommandRouterLogger extends Pick<HostDaemonLogger, "warn"> {
  debug?: HostDaemonLogger["debug"];
}

interface PendingCommandResultReport {
  command: HostDaemonCommand;
  result: CommandResultReport;
}

type EnvironmentLaneMode = "read" | "write";
type CommandLifecycleOutcome = "reported" | "report_deferred";

interface EnvironmentLaneState {
  /** All admitted read and write work. Writes wait on this tail. */
  tail: Promise<void>;
  /** Last admitted write. Reads wait on this tail, then join `tail`. */
  writeTail: Promise<void>;
}

type FileWriteLaneCommand = Extract<
  HostDaemonCommandEnvelope["command"],
  {
    type:
      | "host.write_file_relative"
      | "host.delete_file_relative"
      | "host.delete_path_relative";
  }
>;
interface EnvironmentLaneWorkMetrics {
  startedAtMs: number | null;
}

interface ExecutedCommandResult {
  handlerMs: number;
  result: CommandResultReport;
}

interface CommandResultBaseReport {
  attemptId: string;
  commandId: string;
  type: HostDaemonCommand["type"];
}

interface CreateSuccessfulCommandResultArgs {
  baseReport: CommandResultBaseReport;
  handlerStartedAtMs: number;
  result: HostDaemonCommandResult;
}

interface CommandLifecycleTiming {
  commandId: string;
  commandType: HostDaemonCommand["type"];
  cursor: number;
  daemonQueueWaitMs: number;
  environmentId: string | undefined;
  fetchedAt: string;
  handlerMs: number;
  laneMode: EnvironmentLaneMode | null;
  laneWaitMs: number;
  ok: boolean;
  outcome: CommandLifecycleOutcome;
  reportMs: number;
  reportQueueWaitMs: number;
  totalMs: number;
}

type ReadCommandFetchedAt = (
  envelope: HostDaemonCommandEnvelope,
) => number | undefined;

export interface CommandRouterOptions {
  dataDir: CommandDispatchOptions["dataDir"];
  fetchProjectAttachment: CommandDispatchOptions["fetchProjectAttachment"];
  runtimeManager: RuntimeManager;
  terminalManager?: CommandDispatchOptions["terminalManager"];
  reportResult?: (result: CommandResultReport) => Promise<void>;
  eventSink: CommandDispatchOptions["eventSink"];
  listModels?: CommandDispatchOptions["listModels"];
  resolveInteractiveRequest?: CommandDispatchOptions["resolveInteractiveRequest"];
  recordReplayCaptureThreadMetadata?: CommandDispatchOptions["recordReplayCaptureThreadMetadata"];
  recordReplayCaptureTurnRequest?: CommandDispatchOptions["recordReplayCaptureTurnRequest"];
  replayTasks?: CommandDispatchOptions["replayTasks"];
  threadStorageRootPath: string;
  logger: CommandRouterLogger;
  readFetchedAt?: ReadCommandFetchedAt;
  now?: () => number;
}

const HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS = 1_000;

function roundDurationMs(durationMs: number): number {
  return Math.round(durationMs * 10) / 10;
}

function removeReportSession(
  report: HostDaemonCommandResultReport,
): HostDaemonCommandResultReportWithoutSession {
  const { sessionId: _sessionId, ...withoutSession } = report;
  return withoutSession;
}

function elapsedMs(startedAtMs: number): number {
  return performance.now() - startedAtMs;
}

function readCommandEnvironmentId(
  command: HostDaemonCommand,
): string | undefined {
  if ("environmentId" in command) {
    return command.environmentId;
  }
  return undefined;
}

export class CommandRouter {
  private readonly reportResult;
  private readonly logger;
  private readonly now;
  private readonly readFetchedAt;
  private readonly environmentLanes = new Map<string, EnvironmentLaneState>();
  private readonly fileWriteLaneTails = new Map<string, Promise<void>>();
  // Per-thread barrier keyed by threadId. A turn submission
  // (turn.submit/thread.start) waits for an in-flight thread.unarchive of the
  // same thread so it cannot resume a still-archived provider session.
  private readonly threadUnarchiveBarriers = new Map<string, Promise<void>>();
  // Stale failed reports retry in the background after the current result is
  // reported, so one permanently failing result cannot block newer completions.
  private readonly pendingResults: PendingCommandResultReport[] = [];
  private pendingRetryPromise: Promise<void> | null = null;
  private reportingPromise: Promise<void> = Promise.resolve();

  constructor(private readonly options: CommandRouterOptions) {
    this.reportResult = options.reportResult ?? (async () => undefined);
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.readFetchedAt = options.readFetchedAt ?? (() => undefined);
  }

  async handleCommands(commands: HostDaemonCommandEnvelope[]): Promise<void> {
    const tasks = commands.map((command) => this.dispatchEnvelope(command));
    await Promise.all(tasks);
    await this.reportingPromise;
  }

  async handleOnlineRpcRequest(
    message: HostDaemonOnlineRpcRequestMessage,
  ): Promise<HostDaemonOnlineRpcResponseMessage> {
    const handlerStartedAtMs = performance.now();
    try {
      const result = await this.executeOnlineRpcCommand(message.command);
      this.logOnlineRpc({
        commandType: message.command.type,
        handlerMs: elapsedMs(handlerStartedAtMs),
        ok: true,
      });
      return hostDaemonOnlineRpcResponseMessageSchema.parse({
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: message.command.type,
        ok: true,
        result,
      });
    } catch (error) {
      const errorCode = getErrorCode(error);
      if (!isExpectedCommandDispatchError(error)) {
        this.logger.warn(
          {
            type: message.command.type,
            err: error,
          },
          "online host RPC failed",
        );
      }
      this.logOnlineRpc({
        commandType: message.command.type,
        errorCode,
        handlerMs: elapsedMs(handlerStartedAtMs),
        ok: false,
      });
      return {
        type: "host-rpc.response",
        requestId: message.requestId,
        commandType: message.command.type,
        ok: false,
        errorCode,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private executeOnlineRpcCommand<TCommand extends HostDaemonOnlineRpcCommand>(
    command: TCommand,
  ): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>> {
    const environmentLaneMode = this.getEnvironmentLaneMode(command);
    const result =
      environmentLaneMode && "environmentId" in command
        ? this.runInEnvironmentLane(
            command.environmentId,
            environmentLaneMode,
            () =>
              dispatchOnlineRpcCommand(command, this.createDispatchOptions()),
          )
        : dispatchOnlineRpcCommand(command, this.createDispatchOptions());
    return result.then((value) =>
      parseHostDaemonOnlineRpcResultForCommand(command, value),
    );
  }

  private async dispatchEnvelope(
    envelope: HostDaemonCommandEnvelope,
  ): Promise<void> {
    const routerReceivedAtWallMs = this.now();
    const fetchedAtWallMs =
      this.readFetchedAt(envelope) ?? routerReceivedAtWallMs;
    const fetchedAt = new Date(fetchedAtWallMs).toISOString();
    const receivedAtMs = performance.now();
    const laneWorkMetrics: EnvironmentLaneWorkMetrics = {
      startedAtMs: null,
    };
    let task: Promise<ExecutedCommandResult>;
    const fileWriteLaneKey = this.getFileWriteLaneKey(envelope.command);
    const environmentLaneMode = this.getEnvironmentLaneMode(envelope.command);
    const runCommand = () =>
      this.runAfterThreadUnarchiveBarrier(envelope.command, () =>
        this.executeCommandWithLaneStart(envelope, laneWorkMetrics),
      );
    if (fileWriteLaneKey) {
      task = this.runInFileWriteLane(fileWriteLaneKey, runCommand);
    } else if (environmentLaneMode && "environmentId" in envelope.command) {
      const { environmentId } = envelope.command;
      if (!environmentId) {
        throw new Error(
          `Command ${envelope.command.type} is missing environmentId`,
        );
      }
      task = this.runInEnvironmentLane(
        environmentId,
        environmentLaneMode,
        runCommand,
      );
    } else {
      task = runCommand();
    }
    // Register synchronously, before awaiting, so a turn submission dispatched
    // in the same batch observes the unarchive that precedes it.
    this.registerThreadUnarchiveBarrier(envelope.command, task);

    const executed = await task;
    const report: PendingCommandResultReport = {
      command: envelope.command,
      result: executed.result,
    };
    const reportQueuedAtMs = performance.now();
    let reportStartedAtMs = reportQueuedAtMs;
    let reportMs = 0;
    let outcome: CommandLifecycleOutcome = "reported";
    this.reportingPromise = this.reportingPromise
      .then(async () => {
        reportStartedAtMs = performance.now();
        await this.reportCommandResult(report);
        reportMs = elapsedMs(reportStartedAtMs);
        this.schedulePendingResultRetry();
      })
      .catch((error) => {
        reportMs = elapsedMs(reportStartedAtMs);
        outcome = "report_deferred";
        this.pendingResults.push(report);
        this.logger.warn(
          runtimeErrorLogFields(error),
          "failed to report command result, will retry on next completion",
        );
      });
    await this.reportingPromise;
    const laneStartedAtMs = laneWorkMetrics.startedAtMs ?? receivedAtMs;
    const routerTotalMs = elapsedMs(receivedAtMs);
    const daemonQueueWaitMs = Math.max(
      0,
      routerReceivedAtWallMs - fetchedAtWallMs,
    );
    this.logCommandLifecycle({
      commandId: envelope.id,
      commandType: envelope.command.type,
      cursor: envelope.cursor,
      daemonQueueWaitMs,
      environmentId: readCommandEnvironmentId(envelope.command),
      fetchedAt,
      handlerMs: executed.handlerMs,
      laneMode: environmentLaneMode,
      laneWaitMs: laneStartedAtMs - receivedAtMs,
      ok: executed.result.ok,
      outcome,
      reportMs,
      reportQueueWaitMs: reportStartedAtMs - reportQueuedAtMs,
      totalMs: daemonQueueWaitMs + routerTotalMs,
    });
  }

  private schedulePendingResultRetry(): void {
    if (this.pendingResults.length === 0 || this.pendingRetryPromise) {
      return;
    }
    // This intentionally runs outside `reportingPromise`. Recovery may report
    // stale results after a newer result when a previous failure unblocks.
    const retryPromise = this.retryPendingResults().finally(() => {
      if (this.pendingRetryPromise === retryPromise) {
        this.pendingRetryPromise = null;
      }
    });
    this.pendingRetryPromise = retryPromise;
  }

  private async retryPendingResults(): Promise<void> {
    while (this.pendingResults.length > 0) {
      const report = this.pendingResults[0];
      if (!report) {
        return;
      }
      try {
        await this.reportCommandResult(report);
        this.pendingResults.shift();
      } catch (error) {
        this.logger.warn(
          runtimeErrorLogFields(error),
          "failed to report pending command result, will retry on next completion",
        );
        return;
      }
    }
  }

  private async reportCommandResult(
    report: PendingCommandResultReport,
  ): Promise<void> {
    // Commands that can emit thread events before completing keep the old
    // event-before-result ordering. Pure reads and host-local commands skip the
    // router flush so an in-flight event POST cannot deadlock while waiting for
    // a nested command result.
    if (shouldFlushEventsBeforeReportingCommandResult(report.command)) {
      await this.options.eventSink.flush();
    }
    await this.reportResult(report.result);
  }

  private runInEnvironmentLane<T>(
    environmentId: string,
    mode: EnvironmentLaneMode,
    work: () => Promise<T>,
  ): Promise<T> {
    if (mode === "read") {
      return this.runInEnvironmentReadLane(environmentId, work);
    }
    return this.runInEnvironmentWriteLane(environmentId, work);
  }

  private async executeCommand(
    envelope: HostDaemonCommandEnvelope,
  ): Promise<ExecutedCommandResult> {
    const handlerStartedAtMs = performance.now();
    const command = envelope.command;
    const baseReport = {
      attemptId: envelope.attemptId,
      commandId: envelope.id,
      type: command.type,
    };
    const dispatchOptions = this.createDispatchOptions();

    try {
      const result = await dispatchCommand(command, dispatchOptions);
      return this.createSuccessfulCommandResult({
        baseReport,
        handlerStartedAtMs,
        result,
      });
    } catch (error) {
      const errorCode = getErrorCode(error);
      if (!isExpectedCommandDispatchError(error)) {
        this.logger.warn(
          {
            commandId: envelope.id,
            type: command.type,
            err: error,
          },
          "command execution failed",
        );
      }
      return {
        handlerMs: elapsedMs(handlerStartedAtMs),
        result: {
          ...baseReport,
          completedAt: this.now(),
          ok: false,
          errorCode,
          errorMessage: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private createDispatchOptions(): CommandDispatchOptions {
    return {
      fetchProjectAttachment: this.options.fetchProjectAttachment,
      runtimeManager: this.options.runtimeManager,
      terminalManager: this.options.terminalManager,
      dataDir: this.options.dataDir,
      eventSink: this.options.eventSink,
      listModels: this.options.listModels,
      resolveInteractiveRequest: this.options.resolveInteractiveRequest,
      recordReplayCaptureThreadMetadata:
        this.options.recordReplayCaptureThreadMetadata,
      recordReplayCaptureTurnRequest:
        this.options.recordReplayCaptureTurnRequest,
      replayTasks: this.options.replayTasks,
      threadStorageRootPath: this.options.threadStorageRootPath,
    };
  }

  private createSuccessfulCommandResult(
    args: CreateSuccessfulCommandResultArgs,
  ): ExecutedCommandResult {
    const result = hostDaemonCommandResultReportSchema.parse({
      ...args.baseReport,
      sessionId: "local-result-validation",
      completedAt: this.now(),
      ok: true,
      result: args.result,
    });
    return {
      handlerMs: elapsedMs(args.handlerStartedAtMs),
      result: removeReportSession(result),
    };
  }

  private executeCommandWithLaneStart(
    envelope: HostDaemonCommandEnvelope,
    metrics: EnvironmentLaneWorkMetrics,
  ): Promise<ExecutedCommandResult> {
    metrics.startedAtMs = performance.now();
    return this.executeCommand(envelope);
  }

  private logCommandLifecycle(timing: CommandLifecycleTiming): void {
    const shouldLog =
      timing.totalMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS ||
      timing.daemonQueueWaitMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS ||
      timing.handlerMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS ||
      timing.laneWaitMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS ||
      timing.reportMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS ||
      timing.reportQueueWaitMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS ||
      timing.outcome !== "reported" ||
      !timing.ok;
    if (!shouldLog) {
      return;
    }

    this.logger.debug?.(
      {
        commandId: timing.commandId,
        commandType: timing.commandType,
        cursor: timing.cursor,
        daemonQueueWaitMs: roundDurationMs(timing.daemonQueueWaitMs),
        environmentId: timing.environmentId,
        fetchedAt: timing.fetchedAt,
        handlerMs: roundDurationMs(timing.handlerMs),
        laneMode: timing.laneMode,
        laneWaitMs: roundDurationMs(timing.laneWaitMs),
        ok: timing.ok,
        outcome: timing.outcome,
        reportMs: roundDurationMs(timing.reportMs),
        reportQueueWaitMs: roundDurationMs(timing.reportQueueWaitMs),
        totalMs: roundDurationMs(timing.totalMs),
      },
      "Host command lifecycle",
    );
  }

  private logOnlineRpc(args: {
    commandType: HostDaemonOnlineRpcCommand["type"];
    errorCode?: string;
    handlerMs: number;
    ok: boolean;
  }): void {
    const shouldLog =
      args.handlerMs >= HOST_COMMAND_LIFECYCLE_LOG_THRESHOLD_MS || !args.ok;
    if (!shouldLog) {
      return;
    }

    this.logger.debug?.(
      {
        commandType: args.commandType,
        ...(args.errorCode ? { errorCode: args.errorCode } : {}),
        handlerMs: roundDurationMs(args.handlerMs),
        ok: args.ok,
      },
      "Online host RPC",
    );
  }

  private getOrCreateEnvironmentLane(
    environmentId: string,
  ): EnvironmentLaneState {
    const existing = this.environmentLanes.get(environmentId);
    if (existing) {
      return existing;
    }
    const resolved = Promise.resolve();
    const state: EnvironmentLaneState = {
      tail: resolved,
      writeTail: resolved,
    };
    this.environmentLanes.set(environmentId, state);
    return state;
  }

  private runInEnvironmentReadLane<T>(
    environmentId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const state = this.getOrCreateEnvironmentLane(environmentId);
    const previousWrite = state.writeTail;
    const next = previousWrite.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    const previousTail = state.tail;
    // Reads only wait for earlier writes, so adjacent reads can run together.
    // They still join the full tail so later writes wait for every active read.
    const tail = Promise.all([previousTail.catch(() => undefined), done]).then(
      () => undefined,
    );
    state.tail = tail;
    this.deleteEnvironmentLaneWhenIdle(environmentId, state, tail);
    return next;
  }

  private runInEnvironmentWriteLane<T>(
    environmentId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const state = this.getOrCreateEnvironmentLane(environmentId);
    const next = state.tail.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    state.tail = done;
    state.writeTail = done;
    this.deleteEnvironmentLaneWhenIdle(environmentId, state, done);
    return next;
  }

  /**
   * Order a turn submission after any in-flight unarchive for the same thread.
   * thread.unarchive runs on the provider maintenance runtime while turn.submit
   * resumes the thread runtime, so the two are otherwise unordered and a turn
   * can reach the provider before the session is unarchived.
   */
  private async runAfterThreadUnarchiveBarrier<T>(
    command: HostDaemonCommand,
    work: () => Promise<T>,
  ): Promise<T> {
    const threadId = this.getThreadUnarchiveBarrierWaitThreadId(command);
    if (threadId) {
      const barrier = this.threadUnarchiveBarriers.get(threadId);
      if (barrier) {
        await barrier;
      }
    }
    return work();
  }

  private registerThreadUnarchiveBarrier(
    command: HostDaemonCommand,
    task: Promise<ExecutedCommandResult>,
  ): void {
    if (command.type !== "thread.unarchive") {
      return;
    }
    const { threadId } = command;
    const barrier = task.then(
      () => undefined,
      () => undefined,
    );
    this.threadUnarchiveBarriers.set(threadId, barrier);
    void barrier.then(() => {
      if (this.threadUnarchiveBarriers.get(threadId) === barrier) {
        this.threadUnarchiveBarriers.delete(threadId);
      }
    });
  }

  private getThreadUnarchiveBarrierWaitThreadId(
    command: HostDaemonCommand,
  ): string | null {
    if (command.type === "turn.submit" || command.type === "thread.start") {
      return command.threadId;
    }
    return null;
  }

  private runInFileWriteLane<T>(
    key: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previousTail = this.fileWriteLaneTails.get(key) ?? Promise.resolve();
    const next = previousTail.catch(() => undefined).then(work);
    const done = next.then(
      () => undefined,
      () => undefined,
    );
    this.fileWriteLaneTails.set(key, done);
    this.deleteFileWriteLaneWhenIdle(key, done);
    return next;
  }

  private deleteFileWriteLaneWhenIdle(key: string, tail: Promise<void>): void {
    void tail.then(() => {
      if (this.fileWriteLaneTails.get(key) === tail) {
        this.fileWriteLaneTails.delete(key);
      }
    });
  }

  private deleteEnvironmentLaneWhenIdle(
    environmentId: string,
    state: EnvironmentLaneState,
    tail: Promise<void>,
  ): void {
    void tail.then(() => {
      if (
        this.environmentLanes.get(environmentId) === state &&
        state.tail === tail
      ) {
        this.environmentLanes.delete(environmentId);
      }
    });
  }

  private getFileWriteLaneKey(
    command: HostDaemonCommandEnvelope["command"],
  ): string | null {
    if (!this.isFileWriteLaneCommand(command)) {
      return null;
    }
    return `${command.rootPath}\0${command.path}`;
  }

  private isFileWriteLaneCommand(
    command: HostDaemonCommandEnvelope["command"],
  ): command is FileWriteLaneCommand {
    return (
      command.type === "host.write_file_relative" ||
      command.type === "host.delete_file_relative" ||
      command.type === "host.delete_path_relative"
    );
  }

  private getEnvironmentLaneMode(
    command: HostDaemonCommand | HostDaemonOnlineRpcCommand,
  ): EnvironmentLaneMode | null {
    // Execution lanes protect per-environment workspace mutation ordering.
    // `shouldFlushEventsBeforeReportingCommandResult` is a separate
    // event-before-result ordering policy in the host-daemon contract.
    switch (command.type) {
      case "environment.cleanup_preflight":
      case "workspace.status":
      case "workspace.diff":
        return "read";
      case "environment.provision":
      case "environment.destroy":
      case "thread.archive":
      case "workspace.commit":
      case "workspace.squash_merge":
        return "write";
      default:
        return null;
    }
  }
}
