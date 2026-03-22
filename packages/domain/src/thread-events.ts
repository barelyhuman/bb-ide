import { z } from "zod";
import type {
  PromptInput,
  ReasoningLevel,
  SandboxMode,
  ServiceTier,
} from "./shared-types.js";

export const appThreadEventTypeValues = [
  "client/thread/start",
  "client/turn/requested",
  "client/turn/start",
  "system/error",
  "system/manager/user_message",
  "system/thread/interrupted",
  "system/thread-title/updated",
  "system/operation",
  "system/worktree/commit",
  "system/worktree/squash_merge",
  "system/provisioning/started",
  "system/provisioning/progress",
  "system/provisioning/env_setup",
  "system/provisioning/fallback",
  "system/provisioning/completed",
  "system/provisioning/cleanup_failed",
] as const;
export const appThreadEventTypeSchema = z.enum(appThreadEventTypeValues);
export type AppThreadEventType = z.infer<typeof appThreadEventTypeSchema>;

export const threadTurnInitiatorValues = ["user", "agent", "system"] as const;
export const threadTurnInitiatorSchema = z.enum(threadTurnInitiatorValues);
export type ThreadTurnInitiator = z.infer<typeof threadTurnInitiatorSchema>;

export const threadProvisioningReasonValues = [
  "thread-created",
  "boot-created-thread",
  "tell-after-provisioning-failure",
  "tell-after-missing-environment-attachment",
  "resume-missing-provider-thread",
] as const;
export const threadProvisioningReasonSchema = z.enum(
  threadProvisioningReasonValues,
);
export type ThreadProvisioningReason = z.infer<
  typeof threadProvisioningReasonSchema
>;

export const threadEnvironmentStartReasonValues = [
  ...threadProvisioningReasonValues,
  "boot-active-resume",
  "resume-existing-provider-session",
] as const;
export const threadEnvironmentStartReasonSchema = z.enum(
  threadEnvironmentStartReasonValues,
);
export type ThreadEnvironmentStartReason = z.infer<
  typeof threadEnvironmentStartReasonSchema
>;

export const threadProvisioningProgressPhaseValues = [
  "prepare_environment",
  "start_provider_session",
] as const;
export const threadProvisioningProgressPhaseSchema = z.enum(
  threadProvisioningProgressPhaseValues,
);
export type ThreadProvisioningProgressPhase = z.infer<
  typeof threadProvisioningProgressPhaseSchema
>;

export const threadProvisioningProgressStatusValues = [
  "started",
  "completed",
  "failed",
] as const;
export const threadProvisioningProgressStatusSchema = z.enum(
  threadProvisioningProgressStatusValues,
);
export type ThreadProvisioningProgressStatus = z.infer<
  typeof threadProvisioningProgressStatusSchema
>;

export interface ClientExecutionOptionsSnapshot {
  model?: string;
  serviceTier?: ServiceTier;
  reasoningLevel?: ReasoningLevel;
  sandboxMode?: SandboxMode;
  approvalPolicy?: string;
}

export interface ClientOutboundStartEventData {
  direction: "outbound";
  source: "spawn" | "tell";
  initiator?: ThreadTurnInitiator;
  input?: PromptInput[];
  request: {
    method: "thread/start" | "turn/start";
    params: Record<string, unknown>;
  };
  execution: ClientExecutionOptionsSnapshot;
}

export interface SystemErrorEventData {
  code?: string;
  message: string;
  detail?: string;
}

export interface SystemThreadTitleUpdatedEventData {
  title: string;
  previousTitle?: string;
  source: "provider";
  providerMethod?: string;
}

export interface SystemOperationEventData {
  operation: string;
  status: string;
  message: string;
  operationId?: string;
  metadata?: Record<string, unknown>;
}

export interface SystemThreadInterruptedEventData {
  reason: "user";
  message?: string;
}

export interface ProvisioningTranscriptEntry {
  key: string;
  text: string;
  metadata?: Record<string, unknown>;
  startedAt?: number;
}

export interface SystemProvisioningStartedEventData {
  attachedEnvironmentId?: string;
  reason?: ThreadProvisioningReason;
  transcript: ProvisioningTranscriptEntry[];
}

export interface SystemProvisioningProgressEventData {
  phase: ThreadProvisioningProgressPhase;
  status: ThreadProvisioningProgressStatus;
  durationMs?: number;
  transcript: ProvisioningTranscriptEntry[];
}

export interface SystemProvisioningEnvSetupEventData {
  setup: {
    status: "started" | "running" | "completed" | "failed";
    scriptPath: string;
    timeoutMs?: number;
    durationMs?: number;
    output?: string;
  };
  workspaceRoot?: string;
  reason?: ThreadEnvironmentStartReason;
  transcript: ProvisioningTranscriptEntry[];
}

export interface SystemProvisioningFallbackEventData {
  requestedEnvironmentId: string;
  fallbackEnvironmentId: string;
  detail?: string;
  transcript: ProvisioningTranscriptEntry[];
}

export interface SystemProvisioningCompletedEventData {
  attachedEnvironmentId?: string;
  providerThreadId?: string;
  workspaceRoot?: string;
  reason?: ThreadProvisioningReason;
  transcript: ProvisioningTranscriptEntry[];
}

export interface SystemProvisioningCleanupFailedEventData {
  message: string;
  detail?: string;
}

export interface SystemWorktreeCommitEventData {
  status: "committed" | "noop";
  message: string;
  commitSha?: string;
  commitSubject?: string;
  includeUnstaged?: boolean;
}

export interface SystemWorktreeSquashMergeEventData {
  status: "merged" | "noop" | "conflict";
  message: string;
  committed?: boolean;
  commitSha?: string;
  commitSubject?: string;
  mergeBaseBranch?: string;
  conflictFiles?: string[];
}

export interface SystemManagerUserMessageEventData {
  text: string;
  toolCallId?: string;
  turnId?: string;
}

export interface TurnLifecycleEventData {
  turnId?: string;
  input?: PromptInput[];
}

export type ThreadEventDataByAppType = {
  "client/thread/start": ClientOutboundStartEventData;
  "client/turn/requested": ClientOutboundStartEventData;
  "client/turn/start": ClientOutboundStartEventData;
  "system/error": SystemErrorEventData;
  "system/manager/user_message": SystemManagerUserMessageEventData;
  "system/thread/interrupted": SystemThreadInterruptedEventData;
  "system/thread-title/updated": SystemThreadTitleUpdatedEventData;
  "system/operation": SystemOperationEventData;
  "system/worktree/commit": SystemWorktreeCommitEventData;
  "system/worktree/squash_merge": SystemWorktreeSquashMergeEventData;
  "system/provisioning/started": SystemProvisioningStartedEventData;
  "system/provisioning/progress": SystemProvisioningProgressEventData;
  "system/provisioning/env_setup": SystemProvisioningEnvSetupEventData;
  "system/provisioning/fallback": SystemProvisioningFallbackEventData;
  "system/provisioning/completed": SystemProvisioningCompletedEventData;
  "system/provisioning/cleanup_failed": SystemProvisioningCleanupFailedEventData;
};

export type ThreadEventData =
  | ThreadEventDataByAppType[AppThreadEventType]
  | Record<string, unknown>;

export type ThreadEventDataForType<TType extends string> =
  TType extends AppThreadEventType
    ? ThreadEventDataByAppType[TType]
    : Record<string, unknown>;

export const threadEventRowSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  seq: z.number(),
  type: z.string(),
  data: z.record(z.unknown()),
  createdAt: z.number(),
});

export interface ThreadEventRow<TType extends string = string> {
  id: string;
  threadId: string;
  seq: number;
  type: TType;
  data: ThreadEventDataForType<TType>;
  createdAt: number;
}

export type ThreadEventOfType<TType extends string> = ThreadEventRow<TType>;
