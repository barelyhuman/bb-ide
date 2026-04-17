import { type PendingInteractionApprovalDecision } from "@bb/domain";

export function labelForApprovalDecision(
  decision: PendingInteractionApprovalDecision,
): string {
  switch (decision) {
    case "allow_once":
      return "Allow once";
    case "allow_for_session":
      return "Allow for session";
    case "deny":
      return "Deny";
  }
}
