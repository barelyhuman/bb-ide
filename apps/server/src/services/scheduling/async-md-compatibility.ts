import path from "node:path";
import {
  getEnvironment,
  getThread,
  getThreadDynamicContextFileState,
  upsertThreadDynamicContextFileState,
} from "@bb/db";
import { renderTemplate } from "@bb/templates";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  buildPlainManagerSystemInput,
  queueManagerSystemMessage,
} from "../threads/manager-system-messages.js";
import { requireThreadStoragePath } from "../threads/thread-storage.js";

const ASYNC_FILE_NAME = "ASYNC.md";
// Presence-only one-shot marker; dynamic context file states require a content hash.
const ASYNC_MD_MIGRATION_REMINDER_CONTENT_HASH = "async-md-present";

export const ASYNC_MD_MIGRATION_REMINDER_FILE_KEY =
  "manager-async-md-migration-reminder";

interface QueueAsyncMdMigrationReminderArgs {
  threadId: string;
}

interface CheckAsyncMdExistsArgs {
  hostId: string;
  threadStoragePath: string;
}

async function checkAsyncMdExists(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: CheckAsyncMdExistsArgs,
): Promise<boolean> {
  const filePath = path.join(args.threadStoragePath, ASYNC_FILE_NAME);
  try {
    await callHostRetryableOnlineRpc(deps, {
      hostId: args.hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "host.file_metadata",
        path: filePath,
        rootPath: args.threadStoragePath,
      },
    });
    return true;
  } catch (error) {
    if (error instanceof ApiError && error.body.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function queueAsyncMdMigrationReminderIfPresent(
  deps: LoggedPendingInteractionWorkSessionDeps,
  args: QueueAsyncMdMigrationReminderArgs,
): Promise<boolean> {
  const thread = getThread(deps.db, args.threadId);
  if (!thread || thread.type !== "manager" || !thread.environmentId) {
    return false;
  }

  const previous = getThreadDynamicContextFileState(deps.db, {
    fileKey: ASYNC_MD_MIGRATION_REMINDER_FILE_KEY,
    threadId: thread.id,
  });
  if (previous) {
    return false;
  }

  const environment = getEnvironment(deps.db, thread.environmentId);
  if (!environment) {
    return false;
  }

  const threadStoragePath = await requireThreadStoragePath(deps, {
    hostId: environment.hostId,
    threadId: thread.id,
  });
  const asyncMdExists = await checkAsyncMdExists(deps, {
    hostId: environment.hostId,
    threadStoragePath,
  });
  if (!asyncMdExists) {
    upsertThreadDynamicContextFileState(deps.db, {
      contentHash: ASYNC_MD_MIGRATION_REMINDER_CONTENT_HASH,
      contentStatus: "missing",
      fileKey: ASYNC_MD_MIGRATION_REMINDER_FILE_KEY,
      shownAt: Date.now(),
      threadId: thread.id,
    });
    return false;
  }

  const queued = await queueManagerSystemMessage(deps, {
    input: buildPlainManagerSystemInput({
      text: renderTemplate(
        "systemMessageManagerAsyncMdMigrationReminder",
        {},
      ),
    }),
    managerThreadId: thread.id,
  });
  if (!queued) {
    return false;
  }

  upsertThreadDynamicContextFileState(deps.db, {
    contentHash: ASYNC_MD_MIGRATION_REMINDER_CONTENT_HASH,
    contentStatus: "present",
    fileKey: ASYNC_MD_MIGRATION_REMINDER_FILE_KEY,
    shownAt: Date.now(),
    threadId: thread.id,
  });
  return true;
}
