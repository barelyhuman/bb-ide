import { z } from "zod";

export const gitCheckoutRefSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("branch"),
    branchName: z.string().min(1),
    headSha: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("detached"),
    headSha: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("unborn"),
    branchName: z.string().min(1).nullable(),
  }),
  z.object({
    kind: z.literal("unknown"),
    reason: z.string().min(1),
  }),
]);
export type GitCheckoutRef = z.infer<typeof gitCheckoutRefSchema>;

export const workspaceGitOperationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("merge"),
    hasConflicts: z.boolean(),
  }),
  z.object({
    kind: z.literal("rebase"),
    hasConflicts: z.boolean(),
  }),
  z.object({
    kind: z.literal("cherry-pick"),
    hasConflicts: z.boolean(),
  }),
  z.object({
    kind: z.literal("revert"),
    hasConflicts: z.boolean(),
  }),
  z.object({
    kind: z.literal("unknown"),
    reason: z.string().min(1),
    hasConflicts: z.boolean(),
  }),
]);
export type WorkspaceGitOperation = z.infer<typeof workspaceGitOperationSchema>;

export const projectSourceCheckoutSchema = z.object({
  branches: z.array(z.string()),
  checkout: gitCheckoutRefSchema,
  defaultBranch: z.string().min(1).nullable(),
  hasUncommittedChanges: z.boolean(),
  operation: workspaceGitOperationSchema,
});
export type ProjectSourceCheckout = z.infer<typeof projectSourceCheckoutSchema>;
