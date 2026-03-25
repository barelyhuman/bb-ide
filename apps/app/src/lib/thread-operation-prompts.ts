import { assertNever } from "@bb/core-ui";
import type { EnvironmentActionRequest } from "@bb/server-contract";
import { renderTemplate } from "@bb/templates";

type ThreadOperationPromptTarget = "thread" | "project_main";
type SquashMergeCommitFailureStage = "prep_commit" | "squash_commit";

function formatPromptTarget(target: ThreadOperationPromptTarget): string {
  switch (target) {
    case "thread":
      return "this thread workspace";
    case "project_main":
      return "the project primary checkout";
    default:
      return assertNever(target);
  }
}

export function buildSquashMergeConflictFollowUpInstruction(
  request: Extract<EnvironmentActionRequest, { action: "squash_merge" }>,
  options?: {
    target?: ThreadOperationPromptTarget;
    conflictFiles?: string[];
  },
): string {
  const conflictFiles = options?.conflictFiles?.filter((file) => file.trim().length > 0) ?? [];
  const mergeBaseBranch = request.options?.mergeBaseBranch?.trim() || "the default branch";
  return renderTemplate("threadOperationSquashMergeConflictFollowUp", {
    mergeBaseBranch,
    ...(conflictFiles.length > 0 ? { conflictFiles: conflictFiles.join(", ") } : {}),
  });
}

export function buildSquashMergeCommitFailureFollowUpInstruction(
  request: Extract<EnvironmentActionRequest, { action: "squash_merge" }>,
  options: {
    stage: SquashMergeCommitFailureStage;
    errorMessage?: string;
  },
): string {
  const mergeBaseBranch = request.options?.mergeBaseBranch?.trim() || "the default branch";
  const steps: string[] = [];
  switch (options.stage) {
    case "prep_commit":
      steps.push(
        `Squash merge to ${mergeBaseBranch} could not create the prep commit. Please inspect the workspace, fix the commit blocker, create the needed prep commit, and retry the squash merge so the changes land on ${mergeBaseBranch}.`,
      );
      break;
    case "squash_commit":
      steps.push(
        `Squash merge to ${mergeBaseBranch} applied changes but failed while creating the squash commit. Please inspect the merge result, fix the commit blocker, and retry the squash merge so the changes land on ${mergeBaseBranch}.`,
      );
      break;
    default:
      assertNever(options.stage);
  }
  return renderTemplate("threadOperationSquashMergeCommitFailureFollowUp", {
    failureInstruction: steps.join("\n"),
    ...(options.errorMessage?.trim() ? { errorMessage: options.errorMessage.trim() } : {}),
  });
}

export function buildCommitFailureFollowUpInstruction(
  request: Extract<EnvironmentActionRequest, { action: "commit" }>,
  options?: {
    target?: ThreadOperationPromptTarget;
    errorMessage?: string;
  },
): string {
  const exactCommitMessage = request.options?.message?.trim();
  return renderTemplate("threadOperationCommitFailureFollowUp", {
    targetDescription: formatPromptTarget(options?.target ?? "thread"),
    ...(exactCommitMessage
      ? {
          exactCommitMessageInstruction: `Use this commit message exactly: "${exactCommitMessage}".`,
        }
      : {}),
    ...(options?.errorMessage?.trim() ? { errorMessage: options.errorMessage.trim() } : {}),
  });
}
