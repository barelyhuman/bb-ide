import type { ChildProcess, SpawnOptions } from "node:child_process";
import type {
  PersistedEnvironmentRecord,
  SystemEnvironmentInfo,
  ThreadChangeKind,
  ThreadEventDataForType,
  ThreadEventType,
  ThreadGitDiffCommitSummary,
  ThreadWorkStatus,
} from "@beanbag/agent-core";

export interface CreateEnvironmentContext {
  projectId: string;
  threadId: string;
  projectRootPath: string;
  runtimeEnv: Record<string, string | undefined>;
  services?: EnvironmentServices;
}

export interface EnvironmentServices {
  appendEvent?<TType extends ThreadEventType>(
    type: TType,
    data: ThreadEventDataForType<TType>,
    opts?: { broadcastChanges?: readonly ThreadChangeKind[] | false },
  ): void;
  llmCompletion?(args: {
    cwd: string;
    includeUnstaged?: boolean;
  }): Promise<string | undefined>;
}

export interface EnvironmentCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

export interface EnvironmentCommandOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  rawOutput?: boolean;
}

export interface EnvironmentSpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: SpawnOptions["stdio"];
}

export interface IEnvironment {
  readonly kind: string;
  readonly info: SystemEnvironmentInfo;

  serialize(): unknown;
  dispose(): void;
  exists(): boolean;
  supportsHostFilesystemAccess(): boolean;
  isIsolatedWorkspace(): boolean;
  getCheckoutSnapshot(): EnvironmentCheckoutSnapshot;
  getWorkspaceRootUnsafe(): string;
  getWorkspaceStatus(args?: EnvironmentWorkspaceStatusOptions): ThreadWorkStatus;
  watchWorkspaceStatus(onChange: () => void): () => void;
  commitWorkspace(args: EnvironmentWorkspaceCommitOptions): Promise<EnvironmentWorkspaceCommitResult>;
  listWorkspaceCommitsSinceRef(args: EnvironmentWorkspaceCommitsOptions): ThreadGitDiffCommitSummary[];
  getWorkspaceDiff(args: EnvironmentWorkspaceDiffOptions): EnvironmentWorkspaceDiffResult;
  spawn(
    command: string,
    args: string[],
    options?: EnvironmentSpawnOptions,
  ): ChildProcess;
  shouldRunSetupScript(): boolean;
  supportsPromoteToActiveWorkspace(): boolean;
  supportsDemoteFromActiveWorkspace(): boolean;
  supportsSquashMergeIntoDefaultBranch(): boolean;
  promoteToActiveWorkspace(args: PromoteEnvironmentOptions): PromoteEnvironmentResult;
  demoteFromActiveWorkspace(args: DemoteEnvironmentOptions): DemoteEnvironmentResult;
  squashMergeIntoDefaultBranch(
    args: EnvironmentSquashMergeOptions,
  ): Promise<EnvironmentSquashMergeResult>;
  run(
    command: string,
    args: string[],
    options?: EnvironmentCommandOptions,
  ): EnvironmentCommandResult;
}

export interface EnvironmentCheckoutSnapshot {
  branch?: string;
  head: string;
  detached: boolean;
}

export interface EnvironmentWorkspaceStatusOptions {
  defaultBranch?: string;
  mergeBaseBranch?: string;
}

export interface EnvironmentWorkspaceCommitsOptions {
  baseRef?: string;
}

export interface EnvironmentWorkspaceCommitOptions {
  defaultBranch?: string;
  message?: string;
  includeUnstaged?: boolean;
}

export interface EnvironmentWorkspaceCommitResult {
  ok: true;
  commitCreated: boolean;
  message: string;
  workStatus: ThreadWorkStatus;
  commitSha?: string;
  includeUnstaged?: boolean;
}

export type EnvironmentWorkspaceDiffOptions =
  | {
      type: "working_tree";
    }
  | {
      type: "combined";
      baseRef?: string;
    }
  | {
      type: "commit";
      commitSha: string;
    };

export interface EnvironmentWorkspaceDiffResult {
  diff: string;
  truncated: boolean;
}

export interface PromoteEnvironmentResult {
  previousCheckout: EnvironmentCheckoutSnapshot;
  promotedCheckout: EnvironmentCheckoutSnapshot;
}

export interface PromoteEnvironmentOptions {
  activeWorkspaceRoot: string;
}

export interface DemoteEnvironmentResult {
  restoredCheckout: EnvironmentCheckoutSnapshot;
}

export interface DemoteEnvironmentOptions {
  activeWorkspaceRoot: string;
  snapshot: EnvironmentCheckoutSnapshot;
}

export interface EnvironmentSquashMergeMessageContext {
  tempWorkspaceRoot: string;
  mergeBaseBranch: string;
  sourceBranch?: string;
  defaultMessage: string;
}

export type EnvironmentSquashMergeMessageResolver = (
  context: EnvironmentSquashMergeMessageContext,
) => Promise<string | undefined> | string | undefined;

export interface EnvironmentSquashMergeOptions {
  activeWorkspaceRoot: string;
  defaultBranch?: string;
  message?: string;
  commitIfNeeded?: boolean;
  commitMessage?: string;
  includeUnstaged?: boolean;
  resolveMessage?: EnvironmentSquashMergeMessageResolver;
}

export interface EnvironmentSquashMergeResult {
  merged: boolean;
  message: string;
  committed?: boolean;
  conflictFiles?: string[];
}

export interface EnvironmentDefinition<TState = unknown> {
  readonly kind: string;
  readonly info: SystemEnvironmentInfo;
  create(context: CreateEnvironmentContext): IEnvironment;
  restore(state: TState, context: CreateEnvironmentContext): IEnvironment;
  isState(value: unknown): value is TState;
}

export class EnvironmentRegistry {
  #definitions = new Map<string, EnvironmentDefinition<unknown>>();

  register<TState>(definition: EnvironmentDefinition<TState>): this {
    if (this.#definitions.has(definition.kind)) {
      throw new Error(`Environment already registered: ${definition.kind}`);
    }
    this.#definitions.set(
      definition.kind,
      definition as EnvironmentDefinition<unknown>,
    );
    return this;
  }

  get(kind: string): EnvironmentDefinition<unknown> {
    const definition = this.#definitions.get(kind);
    if (!definition) {
      throw new Error(`Unknown environment: ${kind}`);
    }
    return definition;
  }

  has(kind: string): boolean {
    return this.#definitions.has(kind);
  }

  create(kind: string, context: CreateEnvironmentContext): IEnvironment {
    return this.get(kind).create(context);
  }

  restore(
    record: PersistedEnvironmentRecord,
    context: CreateEnvironmentContext,
  ): IEnvironment {
    const definition = this.get(record.kind);
    if (!definition.isState(record.state)) {
      throw new Error(`Invalid serialized state for environment: ${record.kind}`);
    }
    return definition.restore(record.state, context);
  }

  list(): SystemEnvironmentInfo[] {
    return [...this.#definitions.values()].map((definition) => ({
      ...definition.info,
    }));
  }
}
