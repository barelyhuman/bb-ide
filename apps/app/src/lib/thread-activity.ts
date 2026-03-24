import { assertNever } from "@bb/core-ui"
import type { Thread, ThreadStatus } from "@bb/domain"

interface ThreadActivitySummary {
  running: number
  unreadDone: number
  done: number
}

type ThreadVisibilityShape = Pick<Thread, "archivedAt" | "parentThreadId">
type ThreadStatusShape = Pick<
  Thread,
  "status" | "lastReadAt" | "updatedAt" | "parentThreadId"
>
type ThreadActivityShape = ThreadVisibilityShape & ThreadStatusShape

export function isVisibleProjectThread(
  thread: ThreadVisibilityShape,
): boolean {
  return thread.archivedAt == null && thread.parentThreadId == null
}

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

export function summarizeThreadActivity(
  threads: readonly ThreadActivityShape[],
): ThreadActivitySummary {
  let running = 0
  let unreadDone = 0
  let done = 0

  for (const thread of threads) {
    if (!isVisibleProjectThread(thread)) continue

    if (isBusyThread(thread)) {
      running += 1
      continue
    }

    switch (thread.status) {
      case "idle":
        done += 1
        if (isUnreadDoneThread(thread)) {
          unreadDone += 1
        }
        break
      case "error":
      case "active":
      case "created":
      case "provisioning":
        break
      default:
        assertNever(thread.status)
    }
  }

  return {
    running,
    unreadDone,
    done,
  }
}

export function formatThreadActivitySummaryForTitle(
  summary: ThreadActivitySummary,
): string | undefined {
  const segments: string[] = []

  if (summary.running > 0) {
    segments.push(`${summary.running} running`)
  }

  if (summary.unreadDone > 0) {
    segments.push(`${summary.unreadDone} unread`)
  } else if (summary.done > 0) {
    segments.push(`${summary.done} done`)
  }

  if (segments.length === 0) {
    return undefined
  }

  return segments.join(" · ")
}

export function getThreadStatusLabelForTitle(thread: ThreadStatusShape): string {
  if (isBusyThread(thread)) {
    return "Running"
  }

  switch (thread.status) {
    case "idle":
      return isUnreadDoneThread(thread) ? "Unread done" : "Done"
    case "active":
    case "created":
    case "provisioning":
      return "Running"
    case "error":
      return "Error"
    default:
      return assertNever(thread.status)
  }
}
