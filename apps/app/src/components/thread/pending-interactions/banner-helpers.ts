import {
  type PendingInteractionApprovalDecision,
} from "@bb/domain";

export function labelForCommandDecision(
  decision: PendingInteractionApprovalDecision,
): string {
  switch (decision) {
    case "allow_once":
      return "Yes";
    case "allow_for_session":
      return "Yes, and don't ask again this session";
    case "deny":
      return "No";
  }
}

export function labelForPermissionDecision(
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
