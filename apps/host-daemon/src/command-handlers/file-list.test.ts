import { describe, expect, it } from "vitest";
import { finalizeListedFiles } from "./file-list.js";

describe("finalizeListedFiles", () => {
  it("preserves walk order for an empty query", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/z.ts", "src/a.ts", "src/m.ts"],
      limit: 2,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "src/z.ts",
      "src/a.ts",
    ]);
    expect(result.truncated).toBe(true);
  });

  it("sets the display name from the path basename", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/components/PromptBox.tsx"],
      limit: 5,
    });

    expect(result.files).toEqual([
      {
        path: "src/components/PromptBox.tsx",
        name: "PromptBox.tsx",
      },
    ]);
    expect(result.truncated).toBe(false);
  });

  it("does not report truncation below the limit", () => {
    const result = finalizeListedFiles({
      filePaths: ["a.ts", "b.ts"],
      limit: 3,
    });

    expect(result.files.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
    expect(result.truncated).toBe(false);
  });

  it("does not report truncation exactly at the limit", () => {
    const result = finalizeListedFiles({
      filePaths: ["a.ts", "b.ts", "c.ts"],
      limit: 3,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation above the limit", () => {
    const result = finalizeListedFiles({
      filePaths: ["a.ts", "b.ts", "c.ts", "d.ts"],
      limit: 3,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "a.ts",
      "b.ts",
      "c.ts",
    ]);
    expect(result.truncated).toBe(true);
  });

  it("applies query matching before truncating", () => {
    const result = finalizeListedFiles({
      filePaths: [
        "src/a.ts",
        "src/b.ts",
        "apps/app/src/components/promptbox/PromptBox.tsx",
      ],
      query: "prompt",
      limit: 1,
    });

    expect(result.files.map((file) => file.path)).toEqual([
      "apps/app/src/components/promptbox/PromptBox.tsx",
    ]);
    expect(result.truncated).toBe(false);
  });

  it("reports truncation after query matching when more matches remain", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/prompt-a.ts", "src/prompt-b.ts", "src/prompt-c.ts"],
      query: "prompt",
      limit: 2,
    });

    expect(result.files).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("returns an empty untruncated list when a query has no matches", () => {
    const result = finalizeListedFiles({
      filePaths: ["src/a.ts", "src/b.ts"],
      query: "prompt",
      limit: 2,
    });

    expect(result.files).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
