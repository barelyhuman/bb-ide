import {
  isRecord,
  normalizePendingInteractionQuestionOption,
  pendingInteractionPayloadSchema,
  pendingInteractionResolutionSchema,
  pendingInteractionSchema,
  type PendingInteraction,
  type PendingInteractionPayload,
} from "@bb/domain";
import type { PendingInteractionRow } from "@bb/db";
import { ApiError } from "../../errors.js";

function parseStoredPendingInteractionJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new ApiError(500, "internal_error", "Stored pending interaction JSON is invalid");
  }
}

function normalizeLegacyUserInputQuestion(question: unknown): unknown {
  if (!isRecord(question)) {
    return question;
  }

  const options = Array.isArray(question.options)
    ? question.options.map((option) => {
        if (!isRecord(option)) {
          return option;
        }

        return normalizePendingInteractionQuestionOption({
          label: typeof option.label === "string" ? option.label : "",
          description: typeof option.description === "string" ? option.description : "",
          preview:
            typeof option.preview === "string" || option.preview === null
              ? option.preview
              : null,
        });
      })
    : question.options;

  return {
    ...question,
    multiSelect:
      typeof question.multiSelect === "boolean" ? question.multiSelect : false,
    options,
  };
}

function normalizeLegacyPendingInteractionPayload(
  payload: unknown,
): PendingInteractionPayload | unknown {
  if (!isRecord(payload) || typeof payload.kind !== "string") {
    return payload;
  }

  switch (payload.kind) {
    case "permission_request":
      return {
        ...payload,
        toolName:
          typeof payload.toolName === "string" || payload.toolName === null
            ? payload.toolName
            : null,
      };
    case "user_input_request":
      return {
        ...payload,
        questions: Array.isArray(payload.questions)
          ? payload.questions.map(normalizeLegacyUserInputQuestion)
          : payload.questions,
      };
    default:
      return payload;
  }
}

export function toPendingInteraction(row: PendingInteractionRow): PendingInteraction {
  const payload = pendingInteractionPayloadSchema.parse(
    normalizeLegacyPendingInteractionPayload(
      parseStoredPendingInteractionJson(row.payload),
    ),
  );
  const resolution =
    row.resolution === null
      ? null
      : pendingInteractionResolutionSchema.parse(
          parseStoredPendingInteractionJson(row.resolution),
        );

  return pendingInteractionSchema.parse({
    id: row.id,
    threadId: row.threadId,
    turnId: row.turnId,
    providerId: row.providerId,
    providerThreadId: row.providerThreadId,
    providerRequestId: row.providerRequestId,
    providerRequestMethod: row.providerRequestMethod,
    status: row.status,
    payload,
    resolution,
    statusReason: row.statusReason,
    createdAt: row.createdAt,
    resolvedAt: row.resolvedAt,
  });
}
