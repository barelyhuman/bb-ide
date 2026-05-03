import { useCallback, useMemo } from "react";
import { toast } from "sonner";
import type {
  Environment,
  PromptInput,
  Thread,
  WorkspaceStatus,
} from "@bb/domain";
import type {
  CommitActionResponse,
  EnvironmentActionFailureDetails,
  SquashMergeActionResponse,
} from "@bb/server-contract";
import { environmentActionFailureDetailsSchema } from "@bb/server-contract";
import { useDialogState } from "@/hooks/useDialogState";
import type { ThreadGitActionDialogTarget } from "@/components/thread/ThreadGitActionDialog";
import {
  buildCommitFailureFollowUpInstruction,
  buildSquashMergeCommitFailureFollowUpInstruction,
  buildSquashMergeConflictFollowUpInstruction,
} from "@/lib/thread-operation-prompts";
import { HttpError } from "@/lib/api";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import type {
  RequestEnvironmentActionMutationLike,
  SendMessageMutationLike,
} from "./threadDetailMutationTypes";

interface BuildAskAgentInputForGitOperationParams {
  error: unknown;
  mergeBaseBranch?: string;
}

interface GitActionFailure {
  askAgentInput?: PromptInput[];
  message: string;
}

interface ToGitActionFailureParams {
  error: unknown;
  mergeBaseBranch?: string;
}

interface AskAgentToFixGitActionParams {
  input: PromptInput[];
  threadId: string;
}

type AskAgentToFixGitAction = (
  params: AskAgentToFixGitActionParams,
) => void;

interface ShowGitActionErrorToastParams {
  error: unknown;
  mergeBaseBranch?: string;
  onAskAgentToFix: AskAgentToFixGitAction;
  threadId: string;
  toastId: string | number;
}

interface ShowGitActionSuccessToastParams {
  response: GitActionSuccessResponse;
  toastId: string | number;
}

interface SquashMergeThreadParams {
  mergeBaseBranch: string;
}

interface UseThreadGitActionsParams {
  environment?: Environment;
  requestEnvironmentAction: RequestEnvironmentActionMutationLike;
  sendMessage: SendMessageMutationLike;
  thread?: Thread;
  workspaceStatus?: WorkspaceStatus;
}

interface ThreadHeaderGitAction {
  label: string;
  target: ThreadGitActionDialogTarget;
}

type GitActionSuccessResponse =
  | CommitActionResponse
  | SquashMergeActionResponse;

function toEnvironmentActionFailureDetails(
  error: unknown,
): EnvironmentActionFailureDetails | undefined {
  if (
    !(error instanceof HttpError) ||
    typeof error.body !== "object" ||
    error.body === null
  ) {
    return undefined;
  }
  if (!("details" in error.body)) {
    return undefined;
  }

  const result = environmentActionFailureDetailsSchema.safeParse(
    error.body.details,
  );
  return result.success ? result.data : undefined;
}

function buildAskAgentInputForGitOperation({
  error,
  mergeBaseBranch,
}: BuildAskAgentInputForGitOperationParams): PromptInput[] | undefined {
  const details = toEnvironmentActionFailureDetails(error);
  if (!details) {
    return undefined;
  }

  switch (details.kind) {
    case "commit_failed":
      return [
        {
          type: "text",
          text: buildCommitFailureFollowUpInstruction({
            errorMessage: details.errorMessage,
          }),
        },
      ];
    case "squash_merge_conflict":
      if (!mergeBaseBranch) {
        return undefined;
      }
      return [
        {
          type: "text",
          text: buildSquashMergeConflictFollowUpInstruction(
            {
              action: "squash_merge",
              options: {
                mergeBaseBranch,
              },
            },
            { conflictFiles: details.conflictFiles },
          ),
        },
      ];
    case "squash_merge_commit_failed":
      if (!mergeBaseBranch) {
        return undefined;
      }
      return [
        {
          type: "text",
          text: buildSquashMergeCommitFailureFollowUpInstruction(
            {
              action: "squash_merge",
              options: {
                mergeBaseBranch,
              },
            },
            {
              stage: details.stage,
              errorMessage: details.errorMessage,
            },
          ),
        },
      ];
    default:
      return undefined;
  }
}

function toGitActionFailure({
  error,
  mergeBaseBranch,
}: ToGitActionFailureParams): GitActionFailure {
  const message = getMutationErrorMessage({
    error,
    fallbackMessage: "Failed to start git action.",
  });

  return {
    message,
    askAgentInput: buildAskAgentInputForGitOperation({
      error,
      mergeBaseBranch,
    }),
  };
}

function showGitActionSuccessToast({
  response,
  toastId,
}: ShowGitActionSuccessToastParams): void {
  const description =
    response.action === "commit" ? response.commitSubject : undefined;

  toast.success(response.message, {
    id: toastId,
    ...(description ? { description } : {}),
  });
}

function showGitActionErrorToast({
  error,
  mergeBaseBranch,
  onAskAgentToFix,
  threadId,
  toastId,
}: ShowGitActionErrorToastParams): void {
  const failure = toGitActionFailure({ error, mergeBaseBranch });
  const askAgentInput = failure.askAgentInput;

  toast.error(failure.message, {
    id: toastId,
    ...(askAgentInput
      ? {
          action: {
            label: "Ask agent to fix",
            onClick: () =>
              onAskAgentToFix({
                input: askAgentInput,
                threadId,
              }),
          },
        }
      : {}),
  });
}

export function useThreadGitActions({
  environment,
  requestEnvironmentAction,
  sendMessage,
  thread,
  workspaceStatus,
}: UseThreadGitActionsParams) {
  const threadGitActionDialog = useDialogState<ThreadGitActionDialogTarget>();
  const workspaceWorkingTree = workspaceStatus?.workingTree;
  const workspaceMergeBase = workspaceStatus?.mergeBase;
  const canUseGitUi = thread?.type !== "manager";
  const isArchivedThread = thread?.archivedAt != null;
  const isDirectThreadEnvironment = environment?.managed === false;

  const threadHeaderGitActions = useMemo<ThreadHeaderGitAction[]>(() => {
    if (!thread || !canUseGitUi || !workspaceStatus || isArchivedThread) {
      return [];
    }

    const actions: ThreadHeaderGitAction[] = [];

    const hasUncommitted = workspaceWorkingTree?.hasUncommittedChanges === true;
    const hasUnmerged =
      workspaceMergeBase?.hasCommittedUnmergedChanges === true;

    if (isDirectThreadEnvironment) {
      if (hasUncommitted) {
        actions.push({ target: { kind: "commit" }, label: "Commit" });
      }
      return actions;
    }

    if (environment?.managed) {
      if (hasUncommitted) {
        actions.push({ target: { kind: "commit" }, label: "Commit" });
      }
      if (hasUncommitted || hasUnmerged) {
        actions.push({
          target: {
            kind: hasUncommitted ? "commit_and_squash_merge" : "squash_merge",
          },
          label: "Squash merge",
        });
      }
    }

    return actions;
  }, [
    canUseGitUi,
    environment?.managed,
    isArchivedThread,
    isDirectThreadEnvironment,
    thread,
    workspaceMergeBase?.hasCommittedUnmergedChanges,
    workspaceStatus,
    workspaceWorkingTree?.hasUncommittedChanges,
  ]);

  const handleAskAgentToFixGitAction = useCallback(
    async ({ input, threadId }: AskAgentToFixGitActionParams) => {
      if (sendMessage.isPending) {
        return;
      }

      const toastId = toast.loading("Asking the agent to fix this...");

      try {
        await sendMessage.mutateAsync({
          id: threadId,
          input,
          mode: "auto",
        });
        toast.success("Asked the agent to fix this.", { id: toastId });
      } catch (error) {
        toast.error(
          getMutationErrorMessage({
            error,
            fallbackMessage: "Failed to ask the agent to fix this.",
          }),
          { id: toastId },
        );
      }
    },
    [sendMessage],
  );

  const handleCommitThread = useCallback(async () => {
    const attachedEnvironmentId = thread?.environmentId;
    if (!thread || !attachedEnvironmentId) {
      return;
    }
    const threadId = thread.id;

    const toastId = toast.loading("Committing changes...");

    try {
      const response = await requestEnvironmentAction.mutateAsync({
        id: attachedEnvironmentId,
        action: "commit",
      });
      if (response.action !== "commit") {
        throw new Error("Expected commit action response.");
      }
      showGitActionSuccessToast({
        response,
        toastId,
      });
    } catch (nextError) {
      showGitActionErrorToast({
        error: nextError,
        onAskAgentToFix: (params) => void handleAskAgentToFixGitAction(params),
        threadId,
        toastId,
      });
    }
  }, [handleAskAgentToFixGitAction, requestEnvironmentAction, thread]);

  const handleSquashMergeThread = useCallback(
    async ({ mergeBaseBranch }: SquashMergeThreadParams) => {
      const attachedEnvironmentId = thread?.environmentId;
      if (!thread || !attachedEnvironmentId) {
        return;
      }
      const threadId = thread.id;

      const toastId = toast.loading("Squash merge in progress...");

      try {
        const response = await requestEnvironmentAction.mutateAsync({
          id: attachedEnvironmentId,
          action: "squash_merge",
          options: {
            mergeBaseBranch,
          },
        });
        if (response.action !== "squash_merge") {
          throw new Error("Expected squash merge action response.");
        }
        showGitActionSuccessToast({
          response,
          toastId,
        });
      } catch (nextError) {
        showGitActionErrorToast({
          error: nextError,
          onAskAgentToFix: (params) =>
            void handleAskAgentToFixGitAction(params),
          mergeBaseBranch,
          threadId,
          toastId,
        });
      }
    },
    [handleAskAgentToFixGitAction, requestEnvironmentAction, thread],
  );

  return {
    handleAskAgentToFixGitAction,
    handleCommitThread,
    handleSquashMergeThread,
    isThreadGitActionPending: requestEnvironmentAction.isPending,
    threadGitActionDialog,
    threadHeaderGitActions,
  };
}
