import { assertNever } from "@bb/core-ui"
import type { Thread, ThreadStatus } from "@bb/domain"

type ThreadStatusShape = Pick<
  Thread,
  "status" | "lastReadAt" | "updatedAt" | "parentThreadId"
>

export function isRunningThreadStatus(status: ThreadStatus): boolean {
  switch (status) {
    case "active":
    case "created":
    case "provisioning":
      return true
    case "error":
    case "idle":
      return false
    default:
      return assertNever(status)
  }
}

export function isBusyThread(thread: Pick<Thread, "status">): boolean {
  return isRunningThreadStatus(thread.status)
}

export function isUnreadDoneThread(thread: ThreadStatusShape): boolean {
  if (thread.parentThreadId != null) {
    return false
  }

  switch (thread.status) {
    case "idle":
      return (thread.lastReadAt ?? 0) < thread.updatedAt
    case "active":
    case "created":
    case "provisioning":
    case "error":
      return false
    default:
      return assertNever(thread.status)
  }
}

