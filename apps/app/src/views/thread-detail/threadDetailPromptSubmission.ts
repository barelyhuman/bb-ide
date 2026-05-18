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

export interface CreateQueuedFollowUpRequest
  extends CreateQueuedMessageRequest {
  id: string;
}

export interface SendQueuedSteerRequest {
  id: string;
  mode: "steer";
  queuedMessageId: string;
}

interface ThreadExecutionSelection {
  model: string;
  permissionMode: PermissionMode;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier | undefined;
  supportsServiceTier: boolean;
}

interface SharedThreadExecutionRequestFields {
  permissionMode: PermissionMode;
  reasoningLevel: ReasoningLevel;
  serviceTier?: ServiceTier;
}

interface BaseFollowUpRequestArgs {
  input: PromptInput[];
  threadId: string;
}

export interface BuildAutoFollowUpRequestArgs
  extends BaseFollowUpRequestArgs,
    ThreadExecutionSelection {}

export interface BuildCreateQueuedFollowUpRequestArgs
  extends BaseFollowUpRequestArgs,
    ThreadExecutionSelection {}

export interface BuildSteerFollowUpRequestArgs
  extends BaseFollowUpRequestArgs {}

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

interface QueuedMessageForSteer {
  id: string;
}

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

export function buildAutoFollowUpRequest({
  input,
  threadId,
  ...executionSelection
}: BuildAutoFollowUpRequestArgs): SendMessageMutationRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    mode: "auto",
    ...(executionSelection.model ? { model: executionSelection.model } : {}),
    ...buildSharedThreadExecutionRequestFields(executionSelection),
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
  input,
  threadId,
  ...executionSelection
}: BuildCreateQueuedFollowUpRequestArgs): CreateQueuedFollowUpRequest | null {
  if (input.length === 0) {
    return null;
  }

  return {
    id: threadId,
    input,
    model: executionSelection.model,
    ...buildSharedThreadExecutionRequestFields(executionSelection),
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

function buildSharedThreadExecutionRequestFields({
  permissionMode,
  reasoningLevel,
  serviceTier,
  supportsServiceTier,
}: ThreadExecutionSelection): SharedThreadExecutionRequestFields {
  return {
    ...(supportsServiceTier && serviceTier ? { serviceTier } : {}),
    reasoningLevel,
    permissionMode,
  };
}
