import { getThread } from "@bb/db";
import type { Thread } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { throwParentThreadInvalid } from "../lib/lifecycle-api-errors.js";

export type ManagerParentThread = Pick<
  Thread,
  "archivedAt" | "deletedAt" | "environmentId" | "id" | "projectId" | "type"
>;

export interface IsLiveManagerParentThreadArgs {
  parentThread: ManagerParentThread | null;
  projectId: string;
}

export interface AssertValidManagerParentThreadArgs {
  parentThreadId: string;
  projectId: string;
}

export function isLiveManagerParentThread(
  args: IsLiveManagerParentThreadArgs,
): boolean {
  return (
    args.parentThread !== null &&
    args.parentThread.projectId === args.projectId &&
    args.parentThread.type === "manager" &&
    args.parentThread.archivedAt === null &&
    args.parentThread.deletedAt === null
  );
}

export function assertValidManagerParentThread(
  deps: Pick<AppDeps, "db">,
  args: AssertValidManagerParentThreadArgs,
): Thread {
  const parentThread = getThread(deps.db, args.parentThreadId);
  if (parentThread === null) {
    throwParentThreadInvalid("not_found");
  }
  const liveParentThread: Thread = parentThread;

  if (liveParentThread.projectId !== args.projectId) {
    throwParentThreadInvalid("wrong_project");
  }
  if (liveParentThread.type !== "manager") {
    throwParentThreadInvalid("not_a_manager");
  }
  if (liveParentThread.archivedAt !== null) {
    throwParentThreadInvalid("archived");
  }
  if (liveParentThread.deletedAt !== null) {
    throwParentThreadInvalid("deleted");
  }

  return liveParentThread;
}
