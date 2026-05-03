import {
  formatTimelinePath,
  type TimelinePathDisplayMode,
} from "./timeline-path-display.js";

export type FileChangeAction = "created" | "deleted" | "renamed" | "edited";

export interface FileChangeDiffStats {
  added: number;
  removed: number;
}

export interface FileChangeLike {
  path: string;
  kind?: string | null;
  movePath?: string | null;
  diff?: string | null;
}

export interface FormatFileChangePathArgs {
  change: FileChangeLike;
  mode: TimelinePathDisplayMode;
}

const EMPTY_DIFF_STATS: FileChangeDiffStats = {
  added: 0,
  removed: 0,
};

function normalizeFileChangeKind(kind: string | null | undefined): string {
  return (kind ?? "").toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function isPatchMetadataLine(line: string): boolean {
  return (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ") ||
    line.startsWith("@@") ||
    line === "\\ No newline at end of file"
  );
}

function hasSubstantiveDiff(change: FileChangeLike): boolean {
  const diff = change.diff;
  if (!diff) return false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+") || line.startsWith("-")) return true;
  }
  return false;
}

export function getFileChangeAction(change: FileChangeLike): FileChangeAction {
  if (change.movePath) {
    return hasSubstantiveDiff(change) ? "edited" : "renamed";
  }

  const kind = normalizeFileChangeKind(change.kind);
  if (kind.includes("add") || kind.includes("create")) return "created";
  if (kind.includes("delete") || kind.includes("remove")) return "deleted";
  return "edited";
}

export function getFileChangeActionPastTense(
  action: FileChangeAction,
): string {
  switch (action) {
    case "created":
      return "Created";
    case "deleted":
      return "Deleted";
    case "renamed":
      return "Renamed";
    case "edited":
      return "Edited";
  }
}

export function getFileChangeActionPresentTense(
  action: FileChangeAction,
): string {
  switch (action) {
    case "created":
      return "Creating";
    case "deleted":
      return "Deleting";
    case "renamed":
      return "Renaming";
    case "edited":
      return "Editing";
  }
}

export function formatFileChangePath({
  change,
  mode,
}: FormatFileChangePathArgs): string {
  const sourcePath = formatTimelinePath({ path: change.path, mode });
  if (!change.movePath) {
    return sourcePath;
  }
  if (getFileChangeAction(change) === "edited") {
    return formatTimelinePath({ path: change.movePath, mode });
  }
  return `${sourcePath} -> ${formatTimelinePath({
    path: change.movePath,
    mode,
  })}`;
}

function countPlainContentLines(diff: string): number {
  return diff
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)
    .filter((line) => !isPatchMetadataLine(line)).length;
}

export function getFileChangeDiffStats(
  change: FileChangeLike,
): FileChangeDiffStats {
  const diff = change.diff;
  if (!diff) {
    return EMPTY_DIFF_STATS;
  }

  let added = 0;
  let removed = 0;
  let sawUnifiedDiffLine = false;
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) {
      sawUnifiedDiffLine = true;
      added += 1;
      continue;
    }
    if (line.startsWith("-")) {
      sawUnifiedDiffLine = true;
      removed += 1;
    }
  }
  if (sawUnifiedDiffLine) {
    return { added, removed };
  }

  const plainContentLineCount = countPlainContentLines(diff);
  switch (getFileChangeAction(change)) {
    case "created":
      return { added: plainContentLineCount, removed: 0 };
    case "deleted":
      return { added: 0, removed: plainContentLineCount };
    case "renamed":
    case "edited":
      return EMPTY_DIFF_STATS;
  }
}
