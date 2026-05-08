import { describe, expect, it } from "vitest";
import {
  formatChangeSummary,
  formatWorkspaceChangedFilesLabel,
  formatWorkspaceFileStatus,
} from "./workspace-change-summary";

describe("workspace-change-summary", () => {
  it("formats singular and plural file labels", () => {
    expect(formatWorkspaceChangedFilesLabel(1)).toBe("1 file");
    expect(formatWorkspaceChangedFilesLabel(2)).toBe("2 files");
  });

  it("includes +/- counts when line changes exist", () => {
    expect(
      formatChangeSummary({
        filesCount: 3,
        insertions: 9,
        deletions: 4,
      }),
    ).toBe("3 files, +9 -4");
  });

  it("omits +/- counts when only file-level changes exist", () => {
    expect(
      formatChangeSummary({
        filesCount: 1,
        insertions: 0,
        deletions: 0,
      }),
    ).toBe("1 file");
  });

  it("renders a no-changes label for empty tallies", () => {
    expect(
      formatChangeSummary({ filesCount: 0, insertions: 0, deletions: 0 }),
    ).toBe("No changes");
  });

  it("maps untracked status and preserves unknown statuses", () => {
    expect(formatWorkspaceFileStatus("??")).toBe("A?");
    expect(formatWorkspaceFileStatus("XY")).toBe("XY");
  });
});
