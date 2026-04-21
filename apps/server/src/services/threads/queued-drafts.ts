import {
  claimDraft,
  claimNextDraft,
  deleteDraft,
  getDraft,
  getThread,
  releaseDraftClaim,
} from "@bb/db";
import type { Thread, ThreadQueuedMessage } from "@bb/domain";
import type { SendMessageRequest } from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { toQueuedMessage } from "./drafts.js";
import {
  requireEnvironment,
  requireThreadEnvironment,
} from "../lib/entity-lookup.js";
import { sendThreadMessage } from "./thread-send.js";

interface SendQueuedDraftArgs {
  draftId: string;
  threadId: string;
}

type ClaimedDraft = Exclude<ReturnType<typeof claimDraft>, null>;

interface SendClaimedDraftArgs {
  draft: ClaimedDraft;
  threadId: string;
}

interface SendClaimedDraftForThreadArgs {
  draft: ClaimedDraft;
  thread: Thread;
}

function sendQueuedMessagePayload(
  queuedMessage: ThreadQueuedMessage,
): SendMessageRequest {
  return {
    input: queuedMessage.content,
    mode: "auto",
    model: queuedMessage.model,
    permissionMode: queuedMessage.permissionMode,
    reasoningLevel: queuedMessage.reasoningLevel,
    serviceTier: queuedMessage.serviceTier,
  };
}

function claimDraftForSend(
  deps: Pick<AppDeps, "db" | "hub">,
  args: SendQueuedDraftArgs,
): ClaimedDraft {
  const existingDraft = getDraft(deps.db, args.draftId);
  if (!existingDraft || existingDraft.threadId !== args.threadId) {
    throw new ApiError(404, "invalid_request", "Draft not found");
  }

  const claimedDraft = claimDraft(deps.db, deps.hub, args.draftId);
  if (claimedDraft) {
    return claimedDraft;
  }

  const latestDraft = getDraft(deps.db, args.draftId);
  if (!latestDraft || latestDraft.threadId !== args.threadId) {
    throw new ApiError(404, "invalid_request", "Draft not found");
  }
  throw new ApiError(409, "invalid_request", "Draft is already being sent");
}

async function sendClaimedDraft(
  deps: AppDeps,
  args: SendClaimedDraftArgs,
): Promise<ThreadQueuedMessage> {
  const draft = args.draft;
  const queuedMessage = toQueuedMessage(draft);
  const { environment, thread } = requireThreadEnvironment(
    deps.db,
    args.threadId,
  );
  await sendThreadMessage(deps, {
    environment,
    payload: sendQueuedMessagePayload(queuedMessage),
    thread,
    trigger: "auto-dispatch",
  });
  deleteDraft(deps.db, deps.hub, draft.id);
  return queuedMessage;
}

async function sendClaimedDraftForThread(
  deps: AppDeps,
  args: SendClaimedDraftForThreadArgs,
): Promise<ThreadQueuedMessage> {
  const draft = args.draft;
  const queuedMessage = toQueuedMessage(draft);
  if (!args.thread.environmentId) {
    throw new ApiError(409, "invalid_request", "Thread has no environment");
  }
  const environment = requireEnvironment(deps.db, args.thread.environmentId);
  await sendThreadMessage(deps, {
    environment,
    payload: sendQueuedMessagePayload(queuedMessage),
    thread: args.thread,
    trigger: "auto-dispatch",
  });
  deleteDraft(deps.db, deps.hub, draft.id);
  return queuedMessage;
}

export async function sendQueuedDraft(
  deps: AppDeps,
  args: SendQueuedDraftArgs,
): Promise<ThreadQueuedMessage> {
  const draft = claimDraftForSend(deps, args);
  try {
    return await sendClaimedDraft(deps, {
      draft,
      threadId: args.threadId,
    });
  } catch (error) {
    releaseDraftClaim(deps.db, deps.hub, draft.id);
    throw error;
  }
}

export async function sendNextQueuedDraftIfPresent(
  deps: AppDeps,
  args: { threadId: string },
): Promise<boolean> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.archivedAt) {
    return false;
  }

  const nextDraft = claimNextDraft(deps.db, deps.hub, args.threadId);
  if (!nextDraft) {
    return false;
  }

  try {
    await sendClaimedDraftForThread(deps, {
      draft: nextDraft,
      thread,
    });
  } catch (error) {
    releaseDraftClaim(deps.db, deps.hub, nextDraft.id);
    throw error;
  }
  return true;
}
