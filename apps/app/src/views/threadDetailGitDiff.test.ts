import { describe, expect, it } from "vitest";
import {
  doesGitDiffFileMatchPath,
  formatGitDiffFileLabel,
  getGitDiffParseKey,
  getOpenableGitDiffPath,
  parseGitDiffFiles,
  splitGitDiffIntoPatchChunks,
  summarizeGitDiff,
} from "./threadDetailGitDiff";

const SAMPLE_DIFF = [
  "diff --git a/src/old.ts b/src/new.ts",
  "index 1111111..2222222 100644",
  "--- a/src/old.ts",
  "+++ b/src/new.ts",
  "@@ -1 +1 @@",
  "-old",
  "+new",
  "",
].join("\n");

describe("threadDetailGitDiff", () => {
  it("splits multi-file diffs into patch chunks", () => {
    const diff = [
      SAMPLE_DIFF.trimEnd(),
      "diff --git a/src/second.ts b/src/second.ts",
      "index 3333333..4444444 100644",
      "--- a/src/second.ts",
      "+++ b/src/second.ts",
      "@@ -1 +1 @@",
      "-before",
      "+after",
      "",
    ].join("\n");

    expect(splitGitDiffIntoPatchChunks(diff)).toHaveLength(2);
  });

  it("matches git diff files against normalized paths", () => {
    const [file] = parseGitDiffFiles(SAMPLE_DIFF);
    expect(file).toBeDefined();
    if (!file) return;

    expect(doesGitDiffFileMatchPath(file, "src/new.ts")).toBe(true);
    expect(getOpenableGitDiffPath(file)).toBe("src/new.ts");
    expect(formatGitDiffFileLabel(file)).toBe("src/new.ts");
  });

  it("falls back to raw diff counting before parsed files are available", () => {
    expect(summarizeGitDiff([], SAMPLE_DIFF)).toEqual({
      files: 1,
      additions: 1,
      deletions: 1,
    });
  });

  it("builds a stable parse key from diff edges", () => {
    expect(getGitDiffParseKey("abc")).toBe("3:abc:abc");
  });
});
