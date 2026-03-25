import fs from "node:fs/promises";
import path from "node:path";
import {
  createAgentRuntime,
  type AgentRuntime,
} from "@bb/agent-runtime";
import type {
  HostDaemonCommandEnvelope,
  HostDaemonCommandResultReport,
  HostDaemonExecutionOptions,
  environmentProvisionCommandSchema,
} from "@bb/host-daemon-contract";
import { RuntimeManager, type RuntimeEntry } from "./runtime-manager.js";

type RoutedCommandResult = Omit<HostDaemonCommandResultReport, "sessionId">;
type AvailableModel = Awaited<ReturnType<AgentRuntime["listModels"]>>[number];

export interface ThreadRuntimeResolution {
  workspacePath: string;
  projectId?: string;
  providerId?: string;
  providerThreadId?: string;
  options?: HostDaemonExecutionOptions;
  dynamicTools?: Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
}

export interface CommandRouterOptions {
  runtimeManager: RuntimeManager;
  reportResult?: (result: RoutedCommandResult) => Promise<void>;
  resolveThreadRuntime?: (args: {
    environmentId: string;
    threadId: string;
  }) => Promise<ThreadRuntimeResolution | null>;
  listModels?: (providerId: string) => Promise<AvailableModel[]>;
  now?: () => number;
  initialCursor?: number;
}

class RouterError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RouterError";
  }
}

export class CommandRouter {
  private readonly reportResult;
  private readonly listModels;
  private readonly now;
  private readonly environmentLanes = new Map<string, Promise<unknown>>();
  private readonly completedResults = new Map<number, RoutedCommandResult>();
  private lastReportedCursor = 0;
  private reportingPromise: Promise<void> = Promise.resolve();

  constructor(private readonly options: CommandRouterOptions) {
    this.reportResult = options.reportResult ?? (async () => undefined);
    this.listModels = options.listModels ?? defaultListModels;
    this.now = options.now ?? Date.now;
    this.lastReportedCursor = options.initialCursor ?? 0;
  }

  async handleCommands(commands: HostDaemonCommandEnvelope[]): Promise<void> {
    const tasks = commands.map((command) => this.dispatchEnvelope(command));
    await Promise.all(tasks);
    await this.reportingPromise;
  }

  private async dispatchEnvelope(
    envelope: HostDaemonCommandEnvelope,
  ): Promise<void> {
    let task: Promise<RoutedCommandResult>;
    if (this.requiresWorkspaceLane(envelope.command.type)) {
      const environmentId = envelope.command.environmentId;
      if (!environmentId) {
        throw new RouterError(
          "invalid_command",
          `Command ${envelope.command.type} is missing environmentId`,
        );
      }
      task = this.runInEnvironmentLane(
        environmentId,
        () => this.executeCommand(envelope),
      );
    } else {
      task = this.executeCommand(envelope);
    }

    const result = await task;
    this.completedResults.set(envelope.cursor, result);
    this.reportingPromise = this.reportingPromise.then(() => this.flushCompleted());
    await this.reportingPromise;
  }

  private async flushCompleted(): Promise<void> {
    while (this.completedResults.has(this.lastReportedCursor + 1)) {
      const nextCursor = this.lastReportedCursor + 1;
      const result = this.completedResults.get(nextCursor);
      if (!result) {
        break;
      }
      await this.reportResult(result);
      this.completedResults.delete(nextCursor);
      this.lastReportedCursor = nextCursor;
    }
  }

  private runInEnvironmentLane<T>(
    environmentId: string,
    work: () => Promise<T>,
  ): Promise<T> {
    const previous = this.environmentLanes.get(environmentId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.environmentLanes.set(
      environmentId,
      next.then(
        () => undefined,
        () => undefined,
      ),
    );
    return next;
  }

  private async executeCommand(
    envelope: HostDaemonCommandEnvelope,
  ): Promise<RoutedCommandResult> {
    const completedAt = this.now();
    const baseResult = {
      commandId: envelope.id,
      cursor: envelope.cursor,
      completedAt,
      type: envelope.command.type,
    } as const;

    try {
      const result = await this.dispatchCommand(envelope);
      return {
        ...baseResult,
        ok: true as const,
        result,
      };
    } catch (error) {
      return {
        ...baseResult,
        ok: false as const,
        errorCode: getErrorCode(error),
        errorMessage: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async dispatchCommand(
    envelope: HostDaemonCommandEnvelope,
  ): Promise<unknown> {
    const command = envelope.command;

    switch (command.type) {
      case "thread.start": {
        const entry = await this.options.runtimeManager.ensureEnvironment({
          environmentId: command.environmentId,
          workspacePath: command.workspacePath,
        });
        const result = await entry.runtime.startThread({
          threadId: command.threadId,
          projectId: command.projectId,
          providerId: command.providerId,
          input: command.input,
          options: command.options,
          dynamicTools: command.dynamicTools,
        });
        this.options.runtimeManager.markThreadActive(
          command.environmentId,
          command.threadId,
        );
        return result;
      }
      case "thread.resume": {
        const entry = await this.options.runtimeManager.ensureEnvironment({
          environmentId: command.environmentId,
          workspacePath: command.workspacePath,
        });
        const result = await entry.runtime.resumeThread({
          threadId: command.threadId,
          projectId: command.projectId,
          providerThreadId: command.providerThreadId,
          providerId: command.providerId,
          options: command.options,
          resumePath: command.workspacePath,
          dynamicTools: command.dynamicTools,
        });
        this.options.runtimeManager.markThreadActive(
          command.environmentId,
          command.threadId,
        );
        return result;
      }
      case "turn.run": {
        const entry = await this.ensureThreadRuntime(command.environmentId, command.threadId);
        await entry.runtime.runTurn({
          threadId: command.threadId,
          input: command.input,
          options: command.options,
        });
        return {};
      }
      case "turn.steer": {
        const entry = await this.ensureThreadRuntime(command.environmentId, command.threadId);
        await entry.runtime.steerTurn({
          threadId: command.threadId,
          expectedTurnId: command.expectedTurnId,
          input: command.input,
        });
        return {};
      }
      case "thread.stop": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        await entry.runtime.stopThread({ threadId: command.threadId });
        return {};
      }
      case "thread.rename": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        await entry.runtime.renameThread({
          threadId: command.threadId,
          title: command.title,
        });
        return {};
      }
      case "provider.list_models": {
        return {
          models: await this.listModels(command.providerId),
        };
      }
      case "environment.provision": {
        const ranSetup = await this.detectSetupScript(command);
        const entry = await this.options.runtimeManager.ensureEnvironment({
          environmentId: command.environmentId,
          provision: this.toProvisionWorkspaceOptions(command),
        });
        return {
          path: entry.workspace.path,
          isGitRepo: entry.workspace.isGitRepo,
          isWorktree: entry.workspace.isWorktree,
          branchName: await entry.workspace.currentBranch(),
          ranSetup,
        };
      }
      case "environment.destroy": {
        const existing = this.options.runtimeManager.get(command.environmentId);
        if (existing) {
          await this.options.runtimeManager.destroyEnvironment(command.environmentId);
        }
        return {};
      }
      case "workspace.status": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        return {
          workspaceStatus: await entry.workspace.getStatus(),
        };
      }
      case "workspace.diff": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        return {
          diff: await entry.workspace.getDiff({
            mergeBaseBranch: command.mergeBaseBranch,
            selection: command.selection,
          }),
        };
      }
      case "workspace.commit": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        return await entry.workspace.commit({
          message: command.message,
          includeUnstaged: command.includeUnstaged,
        });
      }
      case "workspace.squash_merge": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        const result = await entry.workspace.squashMergeInto({
          targetBranch: command.targetBranch,
          commitMessage: command.commitMessage,
        });
        return {
          merged: result.merged,
          commitSha: result.commitSha,
        };
      }
      case "workspace.reset": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        await entry.workspace.reset();
        return {};
      }
      case "workspace.checkpoint": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        return await entry.workspace.checkpoint({
          commitMessage: command.commitMessage,
          remoteName: command.remoteName,
        });
      }
      case "workspace.promote": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        const primaryWorkspace = await this.options.runtimeManager.openWorkspace(
          command.primaryPath,
        );
        await entry.workspace.promote(primaryWorkspace);
        return { ok: true };
      }
      case "workspace.demote": {
        const entry = await this.requireExistingEnvironment(command.environmentId);
        const primaryWorkspace = await this.options.runtimeManager.openWorkspace(
          command.primaryPath,
        );
        await entry.workspace.demote(primaryWorkspace, command.defaultBranch);
        return { ok: true };
      }
    }
  }

  private async requireExistingEnvironment(
    environmentId: string,
  ): Promise<RuntimeEntry> {
    const entry = await this.options.runtimeManager.getOrAwait(environmentId);
    if (!entry) {
      throw new RouterError(
        "unknown_environment",
        `No runtime exists for environment ${environmentId}`,
      );
    }
    return entry;
  }

  private async ensureThreadRuntime(
    environmentId: string,
    threadId: string,
  ): Promise<RuntimeEntry> {
    let entry = this.options.runtimeManager.get(environmentId);
    let resolution: ThreadRuntimeResolution | null = null;

    if (!entry || !this.options.runtimeManager.hasThread(environmentId, threadId)) {
      resolution = (await this.options.resolveThreadRuntime?.({
        environmentId,
        threadId,
      })) ?? null;
    }

    if (!entry) {
      if (!resolution?.workspacePath) {
        throw new RouterError(
          "unknown_environment",
          `No workspace path available for environment ${environmentId}`,
        );
      }
      entry = await this.options.runtimeManager.ensureEnvironment({
        environmentId,
        workspacePath: resolution.workspacePath,
      });
    }

    if (!this.options.runtimeManager.hasThread(environmentId, threadId)) {
      if (!resolution) {
        resolution = (await this.options.resolveThreadRuntime?.({
          environmentId,
          threadId,
        })) ?? null;
      }
      if (!resolution?.workspacePath) {
        throw new RouterError(
          "unknown_environment",
          `No runtime metadata available for thread ${threadId}`,
        );
      }

      await entry.runtime.resumeThread({
        threadId,
        projectId: resolution.projectId,
        providerThreadId: resolution.providerThreadId,
        providerId: resolution.providerId,
        options: resolution.options,
        resumePath: resolution.workspacePath,
        dynamicTools: resolution.dynamicTools,
      });
      this.options.runtimeManager.markThreadActive(environmentId, threadId);
    }

    return entry;
  }

  private async detectSetupScript(
    command: typeof environmentProvisionCommandSchema._type,
  ): Promise<boolean> {
    const scriptName = command.scriptName ?? ".bb-env-setup.sh";
    const scriptParentPath =
      command.workspaceProvisionType === "unmanaged"
        ? command.path
        : command.sourcePath;

    if (!scriptParentPath) {
      return false;
    }

    try {
      await fs.access(path.join(scriptParentPath, scriptName));
      return true;
    } catch {
      return false;
    }
  }

  private toProvisionWorkspaceOptions(
    command: typeof environmentProvisionCommandSchema._type,
  ) {
    switch (command.workspaceProvisionType) {
      case "unmanaged": {
        const sourcePath = command.sourcePath ?? command.path;
        if (!sourcePath) {
          throw new RouterError(
            "invalid_command",
            `Unmanaged provision missing source path for environment ${command.environmentId}`,
          );
        }
        return {
          type: "unmanaged" as const,
          path: command.path ?? null,
          sourcePath,
        };
      }
      case "managed-worktree":
      case "managed-clone": {
        if (!command.sourcePath || !command.targetPath || !command.branchName) {
          throw new RouterError(
            "invalid_command",
            `Managed provision missing sourcePath/targetPath/branchName for environment ${command.environmentId}`,
          );
        }
        return {
          type: command.workspaceProvisionType,
          sourcePath: command.sourcePath,
          targetPath: command.targetPath,
          branchName: command.branchName,
          scriptName: command.scriptName,
          timeoutMs: command.timeoutMs,
        };
      }
    }
  }

  private requiresWorkspaceLane(type: HostDaemonCommandEnvelope["command"]["type"]): boolean {
    return (
      type === "environment.provision" ||
      type === "environment.destroy" ||
      type.startsWith("workspace.")
    );
  }
}

async function defaultListModels(providerId: string): Promise<AvailableModel[]> {
  const runtime = createAgentRuntime({
    workspacePath: process.cwd(),
    onEvent: () => undefined,
    onToolCall: async () => ({
      contentItems: [],
      success: true,
    }),
  });

  try {
    return await runtime.listModels({ providerId });
  } finally {
    await runtime.shutdown();
  }
}

function getErrorCode(error: unknown): string {
  if (error instanceof RouterError) {
    return error.code;
  }
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return "command_failed";
}
