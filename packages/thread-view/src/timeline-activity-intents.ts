import type {
  TimelineActivityIntent,
  TimelineCommandWorkRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";

export type TimelineExplorationWorkRow =
  | TimelineCommandWorkRow
  | TimelineToolWorkRow;

export function primaryTimelineActivityIntent(
  row: TimelineExplorationWorkRow,
): TimelineActivityIntent | null {
  return (
    row.activityIntents.find((intent) => intent.type !== "unknown") ?? null
  );
}

export function hasTimelineExplorationIntent(
  row: TimelineExplorationWorkRow,
): boolean {
  return primaryTimelineActivityIntent(row) !== null;
}

export function formatTimelineActivityIntentTitle(
  intent: TimelineActivityIntent,
  pending: boolean,
): string {
  switch (intent.type) {
    case "read":
      return `${pending ? "Reading" : "Read"} ${intent.path ?? intent.name}`;
    case "list_files":
      return `${pending ? "Listing" : "Listed"} ${intent.path ?? "files"}`;
    case "search":
      if (intent.path) {
        return `${pending ? "Searching" : "Searched"} ${intent.path}`;
      }
      return `${pending ? "Searching" : "Searched"} ${intent.query ?? "files"}`;
    case "unknown":
      return intent.command;
    default:
      return assertNever(intent);
  }
}

export function formatTimelineActivityIntentDetail(
  intent: TimelineActivityIntent,
): string {
  switch (intent.type) {
    case "read":
      return `Read ${intent.path ?? intent.name}`;
    case "list_files":
      return intent.path ? `Listed files in ${intent.path}` : "Listed files";
    case "search":
      if (intent.query && intent.path) {
        return `Searched for ${intent.query} in ${intent.path}`;
      }
      if (intent.path) {
        return `Searched in ${intent.path}`;
      }
      if (intent.query) {
        return `Searched for ${intent.query}`;
      }
      return "Searched files";
    case "unknown":
      return intent.command;
    default:
      return assertNever(intent);
  }
}

export function getTimelineActivityIntentDetailDedupeKey(
  intent: TimelineActivityIntent,
): string | null {
  switch (intent.type) {
    case "read":
      return `file:${intent.path ?? intent.name}`;
    case "list_files":
    case "search":
    case "unknown":
      return null;
    default:
      return assertNever(intent);
  }
}
