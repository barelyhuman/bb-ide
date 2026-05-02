import { useMemo, type CSSProperties } from "react";
import { parsePatchFiles } from "@pierre/diffs";
import { PatchDiff } from "@pierre/diffs/react";
import type { TimelineFileChange } from "@bb/server-contract";
import { EventCodeBlock } from "../primitives/event-content.js";
import type { ThreadTimelineTheme } from "./types.js";

export interface TimelineFileDiffBlockProps {
  change: TimelineFileChange;
  themeType: ThreadTimelineTheme;
}

interface TimelineDiffViewStyle extends CSSProperties {
  "--diffs-font-size": string;
  "--diffs-line-height": string;
}

const DIFF_VIEW_STYLE: TimelineDiffViewStyle = {
  "--diffs-font-size": "12px",
  "--diffs-line-height": "18px",
};

function normalizedFileChangeKind(kind: string | null): string {
  return (kind ?? "").toLowerCase().replaceAll(/[^a-z0-9]/gu, "");
}

function isCreateChange(change: TimelineFileChange): boolean {
  const kind = normalizedFileChangeKind(change.kind);
  return kind.includes("add") || kind.includes("create");
}

function isDeleteChange(change: TimelineFileChange): boolean {
  const kind = normalizedFileChangeKind(change.kind);
  return kind.includes("delete") || kind.includes("remove");
}

function buildSyntheticPatch(change: TimelineFileChange): string | null {
  if (!change.diff) {
    return null;
  }
  if (change.diff.includes("diff --git ")) {
    return change.diff;
  }

  const oldPath = isCreateChange(change) ? "/dev/null" : `a/${change.path}`;
  const nextPath = isDeleteChange(change)
    ? "/dev/null"
    : `b/${change.movePath ?? change.path}`;
  return [
    `diff --git a/${change.path} b/${change.movePath ?? change.path}`,
    `--- ${oldPath}`,
    `+++ ${nextPath}`,
    change.diff,
  ].join("\n");
}

function canRenderPatch(patch: string): boolean {
  try {
    return parsePatchFiles(patch).some((parsedPatch) => parsedPatch.files.length > 0);
  } catch {
    return false;
  }
}

export function TimelineFileDiffBlock({
  change,
  themeType,
}: TimelineFileDiffBlockProps) {
  const patch = useMemo(() => buildSyntheticPatch(change), [change]);
  const canRender = useMemo(
    () => (patch ? canRenderPatch(patch) : false),
    [patch],
  );

  if (!patch) {
    return null;
  }
  if (!canRender) {
    return (
      <EventCodeBlock maxHeightClassName="max-h-96">{change.diff}</EventCodeBlock>
    );
  }

  return (
    <div
      data-timeline-file-diff=""
      className="overflow-hidden rounded-md border border-border/70 bg-background/70"
      style={DIFF_VIEW_STYLE}
    >
      <PatchDiff
        patch={patch}
        options={{
          disableFileHeader: false,
          overflow: "scroll",
          themeType,
        }}
      />
    </div>
  );
}
