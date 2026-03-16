import { describe, expect, it } from "vitest";
import {
  buildCommitFailureFollowUpInstruction,
  buildSquashMergeCommitFailureFollowUpInstruction,
  buildSquashMergeConflictFollowUpInstruction,
  buildThreadOperationInstruction,
} from "../src/thread-operation-prompts.js";

describe("buildThreadOperationInstruction", () => {
  it("builds commit instructions with explicit options", () => {
    const prompt = buildThreadOperationInstruction({
      operation: "commit",
      options: {
        includeUnstaged: false,
        message: "feat: add tests",
      },
    });

    expect(prompt).toContain("Please commit the changes");
    expect(prompt).toContain("Please commit only currently staged changes");
    expect(prompt).toContain("feat: add tests");
  });

  it("builds squash instructions for project-main commit threads", () => {
    const prompt = buildThreadOperationInstruction(
      {
        operation: "squash_merge",
        options: {
          mergeBaseBranch: "release",
          commitIfNeeded: true,
        },
      },
      { target: "project_main" },
    );

    expect(prompt).toContain("project primary checkout");
    expect(prompt).toContain("release");
    expect(prompt).toContain("Please squash-merge the changes");
  });

  it("builds squash conflict follow-up instructions with conflicted files", () => {
    const prompt = buildSquashMergeConflictFollowUpInstruction(
      {
        operation: "squash_merge",
        options: {
          mergeBaseBranch: "main",
          squashMessage: "feat: merge thread work",
        },
      },
      {
        conflictFiles: ["src/app.ts", "README.md"],
      },
    );

    expect(prompt).toContain("Squash merge to main failed with conflicts.");
    expect(prompt).toContain("Conflicted files: src/app.ts, README.md.");
    expect(prompt).toContain("Please rebase this branch onto main, resolve the conflicts");
    expect(prompt).toContain("retry the squash merge so the changes land on main");
    expect(prompt).not.toContain("Please reply with");
  });

  it("builds squash commit-failure follow-up instructions", () => {
    const prompt = buildSquashMergeCommitFailureFollowUpInstruction(
      {
        operation: "squash_merge",
        options: {
          mergeBaseBranch: "main",
        },
      },
      {
        stage: "squash_commit",
        errorMessage: "nothing to commit, working tree clean",
      },
    );

    expect(prompt).toContain("failed while creating the squash commit");
    expect(prompt).toContain("Git reported: nothing to commit, working tree clean.");
    expect(prompt).not.toContain("Please reply with");
  });

  it("builds commit failure follow-up instructions", () => {
    const prompt = buildCommitFailureFollowUpInstruction(
      {
        operation: "commit",
        options: {
          message: "feat: add tests",
        },
      },
      {
        errorMessage: "Commit message is required",
      },
    );

    expect(prompt).toContain("Commit in this thread workspace failed.");
    expect(prompt).toContain('Use this commit message exactly: "feat: add tests".');
    expect(prompt).toContain("Git reported: Commit message is required.");
  });
});
