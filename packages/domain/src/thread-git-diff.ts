import { z } from "zod";

export const threadGitDiffCommitSummarySchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  subject: z.string(),
  authorName: z.string().optional(),
  authoredAt: z.number().optional(),
});
export type ThreadGitDiffCommitSummary = z.infer<
  typeof threadGitDiffCommitSummarySchema
>;

export const threadGitDiffSelectionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("combined"),
  }),
  z.object({
    type: z.literal("commit"),
    sha: z.string(),
  }),
]);
export type ThreadGitDiffSelection = z.infer<
  typeof threadGitDiffSelectionSchema
>;

export const threadGitDiffModeSchema = z.enum([
  "local_uncommitted",
  "worktree_commits",
]);
export type ThreadGitDiffMode = z.infer<typeof threadGitDiffModeSchema>;

export const threadGitDiffResponseSchema = z.object({
  mode: threadGitDiffModeSchema,
  currentBranch: z.string().optional(),
  mergeBaseBranch: z.string().optional(),
  mergeBaseRef: z.string().optional(),
  commits: z.array(threadGitDiffCommitSummarySchema),
  selection: threadGitDiffSelectionSchema,
  diff: z.string(),
  truncated: z.boolean(),
});
export type ThreadGitDiffResponse = z.infer<
  typeof threadGitDiffResponseSchema
>;
