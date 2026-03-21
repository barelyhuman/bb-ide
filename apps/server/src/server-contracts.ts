import type {
  AvailableModel,
  DemotePrimaryCheckoutResponse,
  EnvironmentOperationRequest,
  EnvironmentOperationResponse,
  EnqueueThreadMessageRequest,
  PrimaryCheckoutStatus,
  PromotePrimaryCheckoutResponse,
  SendQueuedThreadMessageRequest,
  SendQueuedThreadMessageResponse,
  SpawnThreadRequest,
  SystemEnvironmentInfo,
  SystemProviderInfo,
  TellThreadRequest,
  ThreadExecutionOptions,
  ThreadGitDiffResponse,
  ThreadGitDiffSelection,
  ThreadTimelineResponse,
  ThreadToolGroupMessagesRequest,
  ThreadToolGroupMessagesResponse,
} from "@bb/core";
import type { PromptInput, ProviderExecutionOptions, Thread, ThreadEnvironmentStartReason, ThreadEventRow, ThreadTurnInitiator, ThreadWorkStatus } from "@bb/core";

export interface EnvironmentProvisioningEvent {
  type: "env-setup";
  status: "started" | "running" | "completed" | "failed";
  scriptPath: string;
  workspaceRoot?: string;
  branchName?: string;
  headSha?: string;
  timeoutMs?: number;
  durationMs?: number;
  detail?: string;
  reason?: ThreadEnvironmentStartReason;
}

export interface ThreadListFilters {
  projectId?: string;
  parentThreadId?: string;
  includeArchived?: boolean;
  includeWorkStatus?: boolean;
}

export interface ThreadOrchestrator {
  spawn(req: SpawnThreadRequest): Promise<Thread>;
  tell(
    threadId: string,
    request: TellThreadRequest,
    options?: ProviderExecutionOptions,
    context?: { initiator?: ThreadTurnInitiator },
  ): Promise<void>;
  enqueueFollowUp(
    threadId: string,
    request: EnqueueThreadMessageRequest,
  ): Thread;
  removeQueuedFollowUp(threadId: string, queuedMessageId: string): Thread;
  sendQueuedFollowUp(
    threadId: string,
    queuedMessageId: string,
    request?: SendQueuedThreadMessageRequest,
  ): Promise<SendQueuedThreadMessageResponse>;
  deleteThread(threadId: string): Promise<void>;
  systemTell(
    threadId: string,
    request: TellThreadRequest,
    options?: ProviderExecutionOptions,
  ): Promise<void>;
  stop(threadId: string): void;
  archive(threadId: string): Promise<void>;
  unarchive(threadId: string): void;
  requiresForceArchive(threadId: string): boolean;
  updateThread(
    threadId: string,
    request: {
      title?: string;
      mergeBaseBranch?: string | null;
      parentThreadId?: string | null;
    },
  ): Thread;
  markRead(threadId: string): Thread;
  markUnread(threadId: string): Thread;
  requestEnvironmentOperation(
    environmentId: string,
    request: EnvironmentOperationRequest,
  ): Promise<EnvironmentOperationResponse>;
  promoteThreadEnvironmentToPrimaryCheckout(
    threadId: string,
  ): Promise<PromotePrimaryCheckoutResponse>;
  demoteThreadEnvironmentFromPrimaryCheckout(
    threadId: string,
  ): Promise<DemotePrimaryCheckoutResponse>;
  getPrimaryCheckoutStatus(projectId: string): PrimaryCheckoutStatus;
  getRawById(threadId: string): Thread | undefined;
  isPrimaryCheckoutActive(threadId: string): boolean;
  getHydratedByIdAsync(threadId: string): Promise<Thread | undefined>;
  getWorkStatusAsync(
    threadId: string,
    mergeBaseBranch?: string,
  ): Promise<ThreadWorkStatus | undefined>;
  getMergeBaseBranchesAsync(threadId: string): Promise<string[] | undefined>;
  getEvents(threadId: string, afterSeq?: number, limit?: number): ThreadEventRow[];
  getTimeline(
    threadId: string,
    limit?: number,
    includeToolGroupMessages?: boolean,
    includeManagerDebugView?: boolean,
  ): ThreadTimelineResponse;
  getToolGroupMessages(
    threadId: string,
    request: ThreadToolGroupMessagesRequest,
  ): ThreadToolGroupMessagesResponse;
  getGitDiffAsync(
    threadId: string,
    selection?: ThreadGitDiffSelection,
    mergeBaseBranch?: string,
  ): Promise<ThreadGitDiffResponse>;
  resolveThreadOpenPath(threadId: string, relativePath: string): string;
  getOutput(threadId: string): string | undefined;
  getDefaultExecutionOptions(
    threadId: string,
  ): ThreadExecutionOptions | undefined;
  list(filters?: ThreadListFilters): Thread[];
  listAsync(filters?: ThreadListFilters): Promise<Thread[]>;
  getProjectWorkspaceStatusAsync(
    projectId: string,
    rootPath: string,
  ): Promise<ThreadWorkStatus>;
  isActive(threadId: string): boolean;
  getActiveCount(): number;
  getRunningCount(): number;
  listModels(providerId?: string, environmentId?: string): Promise<AvailableModel[]>;
  getProviderInfo(environmentId?: string): Promise<SystemProviderInfo>;
  listProviders(environmentId?: string): Promise<SystemProviderInfo[]>;
  listEnvironments(): SystemEnvironmentInfo[];
  cleanupArchivedEnvironmentsOnBoot(): Promise<void>;
  failInterruptedProvisioningOnBoot(): Promise<void>;
  detachAll(): void;
}

export interface ThreadSchedule {
  id: string;
  projectId: string;
  prompt: PromptInput[];
  intervalMinutes: number;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRunRecord {
  id: string;
  scheduleId: string;
  startedAt: number;
  finishedAt?: number;
  status: "running" | "succeeded" | "failed";
  error?: string;
}

export interface SchedulerService {
  listSchedules(): ThreadSchedule[];
  upsertSchedule(schedule: ThreadSchedule): ThreadSchedule;
  deleteSchedule(id: string): boolean;
  listRuns(scheduleId: string): ScheduleRunRecord[];
  tick(nowMs: number): Promise<void> | void;
}
