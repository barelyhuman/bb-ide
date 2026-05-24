import type { ThreadRuntimeDisplayStatus } from "@bb/domain";
import { assertNever } from "@bb/core-ui";

/**
 * Placeholder copy for the follow-up prompt-box, derived from the thread's
 * runtime display status and whether the thread itself is a manager. Lives in
 * its own module so stories can share the same derivation as production
 * (ThreadDetailPromptArea) — keeping placeholder text from drifting across
 * surfaces.
 */
export function getFollowUpPromptPlaceholder(
  displayStatus: ThreadRuntimeDisplayStatus,
  isManagerThread: boolean,
): string {
  if (displayStatus === "created" || displayStatus === "provisioning") {
    return isManagerThread ? "Hiring manager..." : "Creating thread...";
  }

  switch (displayStatus) {
    case "waiting-for-host":
      return "Host disconnected";
    case "host-reconnecting":
      return "Waiting for host to reconnect...";
    case "error":
      return "Retry by sending a follow-up message";
    case "idle":
    case "active":
      return isManagerThread
        ? "Send a message. @ to mention threads, files, or folders"
        : "Ask for a follow-up. @ to mention files or folders";
    default:
      return assertNever(displayStatus);
  }
}
