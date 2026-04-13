import {
  formatPendingInteractionCommandApprovalResolutionMessage,
  formatPendingInteractionFileChangeApprovalResolutionMessage,
  formatPendingInteractionPermissionResolutionMessage,
  assertNever,
} from "@bb/core-ui";
import {
  type PendingInteraction,
} from "@bb/domain";
import { getThread } from "@bb/db";
import type { AppDeps } from "../../types.js";
import { appendThreadEvent } from "../threads/thread-events.js";

function toPendingInteractionOperationStatus(
  interaction: PendingInteraction,
): "completed" | "failed" | "started" {
  switch (interaction.status) {
    case "pending":
    case "resolving":
      return "started";
    case "resolved":
      return "completed";
    case "interrupted":
    case "expired":
      return "failed";
  }
}

export function formatPendingInteractionLifecycleMessage(
  interaction: PendingInteraction,
): string {
  switch (interaction.status) {
    case "pending": {
      switch (interaction.payload.kind) {
        case "approval":
          switch (interaction.payload.subject.kind) {
            case "command":
              return `Waiting for approval to run ${interaction.payload.subject.command}`;
            case "file_change":
              return "Waiting for approval to edit files";
            case "permission_grant":
              return interaction.payload.subject.toolName
                ? `Waiting for approval to grant ${interaction.payload.subject.toolName}`
                : "Waiting for approval to grant permissions";
            default:
              return assertNever(
                interaction.payload.subject,
                "Unsupported approval subject for pending interaction",
              );
          }
        default:
          throw new Error("Unsupported pending interaction payload");
      }
    }
    case "resolving":
      return "Delivering user response to provider";
    case "resolved":
      if (interaction.resolution === null) {
        return "Interaction resolved";
      }
      switch (interaction.resolution.kind) {
        case "approval":
          switch (interaction.payload.subject.kind) {
            case "command":
              if (interaction.resolution.decision === "deny") {
                return `Permission denied: ${interaction.payload.subject.command}`;
              }
              return formatPendingInteractionCommandApprovalResolutionMessage(
                interaction.resolution.decision,
              );
            case "file_change":
              if (interaction.resolution.decision === "deny") {
                return "Permission denied: file changes";
              }
              return formatPendingInteractionFileChangeApprovalResolutionMessage(
                interaction.resolution.decision,
              );
            case "permission_grant":
              return formatPendingInteractionPermissionResolutionMessage(
                interaction.resolution,
              );
            default:
              return assertNever(
                interaction.payload.subject,
                "Unsupported approval subject for resolved interaction",
              );
          }
        default:
          throw new Error("Unsupported pending interaction resolution");
      }
    case "interrupted":
      return interaction.statusReason ?? "Interaction interrupted";
    case "expired":
      return interaction.statusReason ?? "Interaction expired";
  }

  const exhaustiveStatus: never = interaction.status;
  throw new Error(`Unsupported pending interaction status: ${String(exhaustiveStatus)}`);
}

export function appendPendingInteractionTimelineEvent(
  deps: Pick<AppDeps, "db" | "hub">,
  interaction: PendingInteraction,
): void {
  const thread = getThread(deps.db, interaction.threadId);

  appendThreadEvent(deps, {
    threadId: interaction.threadId,
    environmentId: thread?.environmentId ?? null,
    type: "system/operation",
    data: {
      operation: interaction.payload.kind,
      status: toPendingInteractionOperationStatus(interaction),
      operationId: interaction.id,
      message: formatPendingInteractionLifecycleMessage(interaction),
      metadata: {
        interactionId: interaction.id,
        providerId: interaction.providerId,
        providerRequestId: interaction.providerRequestId,
        subjectKind: interaction.payload.subject.kind,
        itemId: interaction.payload.subject.itemId,
      },
    },
  });
}
