import type {
  PermissionMode,
  PromptInput,
  ReasoningLevel,
  ServiceTier,
  ThreadRuntimeDisplayStatus,
} from "@bb/domain";
import type { CreateQueuedMessageRequest } from "@bb/server-contract";
import type { FollowUpSubmitMode } from "@/components/promptbox/FollowUpPromptBox";
import type { SendMessageMutationRequest } from "./threadDetailMutationTypes";

export interface CreateQueuedFollowUpRequest extends CreateQueuedMessageRequest {
  id: string;
}

export interface SendQueuedSteerRequest {
  id: string;
  mode: "steer";
  queuedMessageId: string;
}

export interface ThreadExecutionSelection {
  model: string;
  permissionMode: PermissionMode;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  supportsServiceTier: boolean;
}

export type FollowUpExecutionSelection = ThreadExecutionSelection | null;

interface SharedThreadExecutionRequestFields {
  model?: string;
  permissionMode?: PermissionMode;
  reasoningLevel?: ReasoningLevel;
  serviceTier?: ServiceTier;
}

interface BaseFollowUpRequestArgs {
  input: PromptInput[];
  threadId: string;
}

export interface BuildAutoFollowUpRequestArgs extends BaseFollowUpRequestArgs {
  execution: FollowUpExecutionSelection;
}

export interface BuildCreateQueuedFollowUpRequestArgs extends BaseFollowUpRequestArgs {
  execution: FollowUpExecutionSelection;
}

export interface BuildSteerFollowUpRequestArgs extends BaseFollowUpRequestArgs {}

export interface BuildQueuedSteerRequestsArgs {
  queuedMessages: readonly QueuedMessageForSteer[];
  threadId: string;
}

export interface CanSubmitSteerBatchArgs {
  hasPromptDraftInput: boolean;
  isFollowUpSubmitting: boolean;
  isQueueMutationPending: boolean;
  queuedMessageCount: number;
  runtimeDisplayStatus: ThreadRuntimeDisplayStatus;
  submitModeKind: FollowUpSubmitMode["kind"];
}

export interface ResolveDefaultExecutionOptionsStateArgs {
  hasConcreteDefaultExecutionOptions: boolean;
  hasResolvedDefaultExecutionOptions: boolean;
  isError: boolean;
}

interface QueuedMessageForSteer {
  id: string;
}

export type DefaultExecutionOptionsState =
  | "available"
  | "loading"
  | "unavailable";

export function shouldQueueFollowUpMessage(
  displayStatus: ThreadRuntimeDisplayStatus,
): boolean {
  return displayStatus === "active" || displayStatus === "host-reconnecting";
}

export function canSubmitSteerBatch({
  hasPromptDraftInput,
  isFollowUpSubmitting,
  isQueueMutationPending,
  queuedMessageCount,
  runtimeDisplayStatus,
  submitModeKind,
}: CanSubmitSteerBatchArgs): boolean {
  return (
    runtimeDisplayStatus === "active" &&
    submitModeKind === "queue" &&
    !isFollowUpSubmitting &&
    !isQueueMutationPending &&
    (queuedMessageCount > 0 || hasPromptDraftInput)
  );
}

export function resolveDefaultExecutionOptionsState({
  hasConcreteDefaultExecutionOptions,
  hasResolvedDefaultExecutionOptions,
  isError,
}: ResolveDefaultExecutionOptionsStateArgs): DefaultExecutionOptionsState {
  if (hasConcreteDefaultExecutionOptions) {
    return "available";
  }
  if (hasResolvedDefaultExecutionOptions || isError) {
    return "unavailable";
  }
  return "loading";
}

export function buildAutoFollowUpRequest({
  execution,
  input,
  threadId,
}: BuildAutoFollowUpRequestArgs): SendMessageMutationRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    mode: "auto",
    ...buildSharedThreadExecutionRequestFields(execution),
  };
}

export function buildSteerFollowUpRequest({
  input,
  threadId,
}: BuildSteerFollowUpRequestArgs): SendMessageMutationRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    mode: "steer",
  };
}

export function buildCreateQueuedFollowUpRequest({
  execution,
  input,
  threadId,
}: BuildCreateQueuedFollowUpRequestArgs): CreateQueuedFollowUpRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    ...buildSharedThreadExecutionRequestFields(execution),
  };
}

export function buildQueuedSteerRequests({
  queuedMessages,
  threadId,
}: BuildQueuedSteerRequestsArgs): SendQueuedSteerRequest[] {
  return queuedMessages.map((queuedMessage) => ({
    id: threadId,
    mode: "steer",
    queuedMessageId: queuedMessage.id,
  }));
}

function buildSharedThreadExecutionRequestFields(
  execution: FollowUpExecutionSelection,
): SharedThreadExecutionRequestFields {
  if (execution === null) {
    return {};
  }

  return {
    model: execution.model,
    ...(execution.supportsServiceTier && execution.serviceTier
      ? { serviceTier: execution.serviceTier }
      : {}),
    reasoningLevel: execution.reasoningLevel,
    permissionMode: execution.permissionMode,
  };
}
