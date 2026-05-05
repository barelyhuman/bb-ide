import type {
  TimelineActivityIntent,
  TimelineCommandWorkRow,
  TimelineToolWorkRow,
} from "@bb/server-contract";
import { assertNever } from "./assert-never.js";
import {
  formatTimelinePath,
  type TimelinePathDisplayMode,
} from "./timeline-path-display.js";

export type TimelineExplorationWorkRow =
  | TimelineCommandWorkRow
  | TimelineToolWorkRow;
type TimelineReadActivityIntent = Extract<
  TimelineActivityIntent,
  { type: "read" }
>;

export interface FormatTimelineActivityIntentTitleArgs {
  intent: TimelineActivityIntent;
  pathMode: TimelinePathDisplayMode;
  pending: boolean;
}

export interface FormatTimelineActivityIntentDetailArgs {
  intent: TimelineActivityIntent;
  pathMode: TimelinePathDisplayMode;
  pending: boolean;
}

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

function readTarget(intent: TimelineReadActivityIntent): string {
  return intent.path ?? intent.name;
}

function formatReadTarget(
  intent: TimelineReadActivityIntent,
  pathMode: TimelinePathDisplayMode,
): string {
  return formatTimelinePath({ path: readTarget(intent), mode: pathMode });
}

export function formatTimelineActivityIntentTitle({
  intent,
  pathMode,
  pending,
}: FormatTimelineActivityIntentTitleArgs): string {
  switch (intent.type) {
    case "read":
      return `${pending ? "Reading" : "Read"} ${formatReadTarget(
        intent,
        pathMode,
      )}`;
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

export function formatTimelineActivityIntentDetail({
  intent,
  pathMode,
  pending,
}: FormatTimelineActivityIntentDetailArgs): string {
  switch (intent.type) {
    case "read": {
      const verb = pending ? "Reading" : "Read";
      return `${verb} ${formatReadTarget(intent, pathMode)}`;
    }
    case "list_files": {
      const verb = pending ? "Listing" : "Listed";
      return intent.path
        ? `${verb} files in ${intent.path}`
        : `${verb} files`;
    }
    case "search": {
      const verb = pending ? "Searching" : "Searched";
      if (intent.query && intent.path) {
        return `${verb} for ${intent.query} in ${intent.path}`;
      }
      if (intent.path) {
        return `${verb} in ${intent.path}`;
      }
      if (intent.query) {
        return `${verb} for ${intent.query}`;
      }
      return `${verb} files`;
    }
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
