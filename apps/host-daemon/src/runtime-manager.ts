import {
  createAgentRuntime,
  type AgentRuntime,
  type AgentRuntimeOptions,
} from "@bb/agent-runtime";
import type { ThreadEvent, WorkspaceProvisionType } from "@bb/domain";
import type { HostDaemonActiveThread } from "@bb/host-daemon-contract";
import type {
  HostWatcher,
  ThreadStorageWatchError,
  WorkspaceWatchError,
} from "@bb/host-watcher";
import {
  provisionWorkspace,
  type HostWorkspace,
  type ProvisionWorkspaceArgs,
} from "@bb/host-workspace";

const STOP_WATCHING = () => undefined;

interface RuntimeThreadState {
  providerThreadId: string;
  status: "active" | "idle";
}

interface ThreadStorageTarget {
  environmentId: string;
  threadId: string;
}

function lazyProvisionOpts(
  workspacePath: string,
  workspaceProvisionType: WorkspaceProvisionType,
): ProvisionWorkspaceArgs {
  switch (workspaceProvisionType) {
    case "unmanaged":
      return { workspaceProvisionType: "unmanaged", path: workspacePath };
    case "managed-worktree":
      return { workspaceProvisionType: "reconnect-managed-worktree", path: workspacePath };
    case "managed-clone":
      return { workspaceProvisionType: "reconnect-managed-clone", path: workspacePath };
  }
}

export interface RuntimeEntry {
  environmentId: string;
  runtime: AgentRuntime;
  stopWatchingStatus: () => void;
  workspace: HostWorkspace;
  path: string;
  threads: Map<string, RuntimeThreadState>;
}

export interface EnsureEnvironmentArgs {
  environmentId: string;
  workspacePath?: string;
  workspaceProvisionType?: WorkspaceProvisionType;
  provision?: ProvisionWorkspaceArgs;
}

export interface RuntimeManagerOptions {
  bridgeBundleDir?: AgentRuntimeOptions["bridgeBundleDir"];
  createRuntime?: (options: AgentRuntimeOptions) => AgentRuntime;
  hostWatcher?: HostWatcher;
  provisionWorkspace?: (
    options: ProvisionWorkspaceArgs,
  ) => Promise<HostWorkspace>;
  adapterFactory?: AgentRuntimeOptions["adapterFactory"];
  shellEnv?: AgentRuntimeOptions["shellEnv"];
  onEvent?: (args: { environmentId: string; event: ThreadEvent }) => void;
  threadStorageRootPath?: string | null;
  onThreadStorageChanged?: (args: {
    environmentId: string;
    threadId: string;
  }) => void;
  onThreadStorageWatchError?: (args: {
    error: ThreadStorageWatchError;
  }) => void;
  onWorkspaceStatusChanged?: (args: { environmentId: string }) => void;
  onWorkspaceStatusWatchError?: (args: {
    error: WorkspaceWatchError;
  }) => void;
  onToolCall?: AgentRuntimeOptions["onToolCall"];
  onStderr?: AgentRuntimeOptions["onStderr"];
  onProcessExit?: AgentRuntimeOptions["onProcessExit"];
}

export class RuntimeManager {
  private readonly createRuntime;
  private readonly hostWatcher;
  private readonly provisionWorkspace;
  private readonly entries = new Map<string, RuntimeEntry>();
  private readonly pendingEntries = new Map<string, Promise<RuntimeEntry>>();
  private stopWatchingThreadStorageRoot: () => void = STOP_WATCHING;

  constructor(private readonly options: RuntimeManagerOptions = {}) {
    this.createRuntime = options.createRuntime ?? createAgentRuntime;
    this.hostWatcher = options.hostWatcher;
    this.provisionWorkspace = options.provisionWorkspace ?? provisionWorkspace;
  }

  get(environmentId: string): RuntimeEntry | undefined {
    return this.entries.get(environmentId);
  }

  async getOrAwait(environmentId: string): Promise<RuntimeEntry | undefined> {
    const existing = this.entries.get(environmentId);
    if (existing) {
      return existing;
    }

    const pending = this.pendingEntries.get(environmentId);
    if (pending) {
      return pending;
    }

    return undefined;
  }

  hasThread(environmentId: string, threadId: string): boolean {
    return this.entries.get(environmentId)?.threads.has(threadId) ?? false;
  }

  markThreadActive(
    environmentId: string,
    threadId: string,
    providerThreadId: string,
  ): void {
    const entry = this.entries.get(environmentId);
    if (!entry) {
      return;
    }

    entry.threads.set(threadId, {
      providerThreadId,
      status: "active",
    });
    this.ensureThreadStorageWatcher();
  }

  markThreadInactive(environmentId: string, threadId: string): void {
    const current = this.entries.get(environmentId)?.threads.get(threadId);
    if (!current) {
      return;
    }

    this.entries.get(environmentId)?.threads.set(threadId, {
      ...current,
      status: "idle",
    });
  }

  listActiveThreads(): HostDaemonActiveThread[] {
    const activeThreads: HostDaemonActiveThread[] = [];
    for (const entry of this.entries.values()) {
      for (const [threadId, thread] of entry.threads) {
        if (thread.status !== "active") {
          continue;
        }
        activeThreads.push({
          threadId,
        });
      }
    }
    return activeThreads;
  }

  async openWorkspace(path: string): Promise<HostWorkspace> {
    return this.provisionWorkspace({
      workspaceProvisionType: "unmanaged",
      path,
    });
  }

  async ensureEnvironment(args: EnsureEnvironmentArgs): Promise<RuntimeEntry> {
    const existing = this.entries.get(args.environmentId);
    if (existing) {
      return existing;
    }

    const pending = this.pendingEntries.get(args.environmentId);
    if (pending) {
      return pending;
    }

    const creation = this.createEntry(args).finally(() => {
      this.pendingEntries.delete(args.environmentId);
    });
    this.pendingEntries.set(args.environmentId, creation);

    const entry = await creation;
    this.entries.set(args.environmentId, entry);
    return entry;
  }

  async destroyEnvironment(environmentId: string): Promise<void> {
    const existing = this.entries.get(environmentId);
    const pending = this.pendingEntries.get(environmentId);
    const entry = existing ?? (pending ? await pending : undefined);

    if (!entry) {
      return;
    }

    this.entries.delete(environmentId);
    this.stopWatchingStatus(entry);
    this.stopWatchingThreadStorageIfUnused();
    await entry.runtime.shutdown();
    await entry.workspace.destroy();
  }

  async shutdownAll(): Promise<void> {
    const entries = [...this.entries.values()];
    for (const pending of this.pendingEntries.values()) {
      try {
        entries.push(await pending);
      } catch {
        // Ignore failed provisions during shutdown
      }
    }
    this.entries.clear();
    this.pendingEntries.clear();

    for (const entry of entries) {
      this.stopWatchingStatus(entry);
      await entry.runtime.shutdown();
      // Do NOT call workspace.destroy() — the server owns managed workspace
      // lifecycle via explicit environment.destroy commands. Daemon shutdown
      // should only release in-memory state and stop provider processes.
    }
    this.stopWatchingThreadStorageRoot();
    this.stopWatchingThreadStorageRoot = STOP_WATCHING;
  }

  private async createEntry(args: EnsureEnvironmentArgs): Promise<RuntimeEntry> {
    const provision =
      args.provision ??
      (args.workspacePath
        ? lazyProvisionOpts(args.workspacePath, args.workspaceProvisionType ?? "unmanaged")
        : null);

    if (!provision) {
      throw new Error(`Missing workspace path for environment ${args.environmentId}`);
    }

    const workspace = await this.provisionWorkspace(provision);
    const stopWatchingStatus = this.hostWatcher
      ? this.hostWatcher.watchWorkspace({
          environmentId: args.environmentId,
          workspacePath: workspace.path,
          onChange: () => {
            this.options.onWorkspaceStatusChanged?.({
              environmentId: args.environmentId,
            });
          },
          onWatchError: (error) => {
            this.options.onWorkspaceStatusWatchError?.({
              error,
            });
          },
        })
      : () => undefined;
    const threads = new Map<string, RuntimeThreadState>();
    let runtime: AgentRuntime | null = null;
    try {
      runtime = this.createRuntime({
        workspacePath: workspace.path,
        adapterFactory: this.options.adapterFactory,
        shellEnv: this.options.shellEnv,
        bridgeBundleDir: this.options.bridgeBundleDir,
        onEvent: (event) => {
          if (event.type === "thread/identity") {
            this.markThreadActive(
              args.environmentId,
              event.threadId,
              event.providerThreadId,
            );
          } else if (event.type === "turn/completed") {
            this.markThreadInactive(args.environmentId, event.threadId);
          }
          this.options.onEvent?.({
            environmentId: args.environmentId,
            event,
          });
        },
        onToolCall:
          this.options.onToolCall ??
          (async () => ({
            contentItems: [],
            success: true,
          })),
        onStderr: this.options.onStderr,
        onProcessExit: (info) => {
          for (const threadId of info.threadIds) {
            threads.delete(threadId);
          }
          const current = this.entries.get(args.environmentId);
          if (
            current?.runtime === runtime &&
            runtime?.listRunningProviders().length === 0
          ) {
            this.stopWatchingStatus(current);
            this.entries.delete(args.environmentId);
            this.stopWatchingThreadStorageIfUnused();
          }
          this.options.onProcessExit?.(info);
        },
      });
    } catch (error) {
      stopWatchingStatus();
      throw error;
    }

    return {
      environmentId: args.environmentId,
      runtime,
      stopWatchingStatus,
      workspace,
      path: workspace.path,
      threads,
    };
  }

  private stopWatchingStatus(entry: RuntimeEntry): void {
    const stopWatchingStatus = entry.stopWatchingStatus;
    entry.stopWatchingStatus = STOP_WATCHING;
    stopWatchingStatus();
  }

  private ensureThreadStorageWatcher(): void {
    if (
      !this.hostWatcher ||
      this.stopWatchingThreadStorageRoot !== STOP_WATCHING
    ) {
      return;
    }

    const threadStorageRootPath = this.options.threadStorageRootPath;
    if (!threadStorageRootPath) {
      return;
    }

    this.stopWatchingThreadStorageRoot = this.hostWatcher.watchThreadStorageRoot({
      threadStorageRootPath,
      resolveThreadTarget: (threadId) => this.findTrackedThreadTarget(threadId),
      onChange: (event) => {
        if (event.kind !== "thread-storage-changed") {
          return;
        }
        this.options.onThreadStorageChanged?.({
          environmentId: event.environmentId,
          threadId: event.threadId,
        });
      },
      onWatchError: (error) => {
        this.options.onThreadStorageWatchError?.({
          error,
        });
      },
    });
  }

  private findTrackedThreadTarget(threadId: string): ThreadStorageTarget | null {
    for (const [environmentId, entry] of this.entries) {
      if (entry.threads.has(threadId)) {
        return {
          environmentId,
          threadId,
        };
      }
    }
    return null;
  }

  private stopWatchingThreadStorageIfUnused(): void {
    for (const entry of this.entries.values()) {
      if (entry.threads.size > 0) {
        return;
      }
    }
    const stopWatchingThreadStorageRoot = this.stopWatchingThreadStorageRoot;
    this.stopWatchingThreadStorageRoot = STOP_WATCHING;
    stopWatchingThreadStorageRoot();
  }
}
