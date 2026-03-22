import type { Hono } from "hono";
import { hc } from "hono/client";
import { z } from "zod";
import {
  availableModelSchema,
  environmentDescriptorSchema,
  environmentRecordSchema,
  projectSchema,
  promptInputSchema,
  providerCapabilitiesSchema,
  reasoningLevelSchema,
  sandboxModeSchema,
  serviceTierSchema,
  threadContextWindowUsageSchema,
  threadEventRowSchema,
  threadExecutionOptionsSchema,
  threadQueuedMessageSchema,
  threadSchema,
  threadStatusSchema,
  threadTypeSchema,
  threadWorkStatusSchema,
  type AvailableModel,
  type EnvironmentRecord,
  type Project,
  type Thread,
  type ThreadContextWindowUsage,
  type ThreadEventRow,
  type ThreadExecutionOptions,
  type ThreadQueuedMessage,
  type ThreadStatus,
  type ThreadType,
  type ThreadWorkStatus,
} from "@bb/domain";
import type { EmptyInput, Endpoint, PathId, PathProjectId, PathThreadAndQueued } from "./common.js";

export const environmentCreationArgsSchema = z.object({
  kind: z.string().min(1),
});
export type EnvironmentCreationArgs = z.infer<
  typeof environmentCreationArgsSchema
>;

export const tellThreadModeSchema = z.enum(["auto", "start", "steer"]);
export type TellThreadMode = z.infer<typeof tellThreadModeSchema>;

export const spawnThreadRequestSchema = z
  .object({
    projectId: z.string().min(1),
    providerId: z.string().min(1).optional(),
    type: threadTypeSchema.optional(),
    title: z.string().min(1).optional(),
    input: z.array(promptInputSchema).min(1).optional(),
    model: z.string().optional(),
    serviceTier: serviceTierSchema.optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    sandboxMode: sandboxModeSchema.optional(),
    environmentId: z.string().min(1).optional(),
    environmentDescriptor: environmentDescriptorSchema.optional(),
    environmentCreationArgs: environmentCreationArgsSchema.optional(),
    developerInstructions: z.string().optional(),
    parentThreadId: z.string().optional(),
    spawnInitiator: z.enum(["user", "agent", "system"]).optional(),
  })
  .superRefine((value, ctx) => {
    const selectedCount = [
      value.environmentId !== undefined,
      value.environmentDescriptor !== undefined,
      value.environmentCreationArgs !== undefined,
    ].filter(Boolean).length;
    if (selectedCount <= 1) {
      return;
    }
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "Provide at most one of environmentId, environmentDescriptor, or environmentCreationArgs",
      path: ["environmentId"],
    });
  });
export type SpawnThreadRequest = z.infer<typeof spawnThreadRequestSchema>;

export const tellThreadRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
  mode: tellThreadModeSchema.optional(),
  demotePrimaryIfNeeded: z.boolean().optional(),
});
export type TellThreadRequest = z.infer<typeof tellThreadRequestSchema>;

export const enqueueThreadMessageRequestSchema = z.object({
  input: z.array(promptInputSchema).min(1),
  model: z.string().optional(),
  serviceTier: serviceTierSchema.optional(),
  reasoningLevel: reasoningLevelSchema.optional(),
  sandboxMode: sandboxModeSchema.optional(),
});
export type EnqueueThreadMessageRequest = z.infer<
  typeof enqueueThreadMessageRequestSchema
>;

export const sendQueuedThreadMessageRequestSchema = z.object({
  mode: z.enum(["auto", "steer-if-active", "steer"]).optional(),
});
export type SendQueuedThreadMessageRequest = z.infer<
  typeof sendQueuedThreadMessageRequestSchema
>;

export const sendQueuedThreadMessageResponseSchema = z.object({
  ok: z.literal(true),
  queuedMessage: threadQueuedMessageSchema,
});
export type SendQueuedThreadMessageResponse = z.infer<
  typeof sendQueuedThreadMessageResponseSchema
>;

export const updateThreadRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    mergeBaseBranch: z.string().min(1).nullable().optional(),
    parentThreadId: z.string().nullable().optional(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.mergeBaseBranch !== undefined ||
      value.parentThreadId !== undefined,
    "At least one field must be provided",
  );
export type UpdateThreadRequest = z.infer<typeof updateThreadRequestSchema>;

export const createProjectRequestSchema = z.object({
  name: z.string(),
  rootPath: z.string(),
});
export type CreateProjectRequest = z.infer<
  typeof createProjectRequestSchema
>;

export const updateProjectRequestSchema = z
  .object({
    name: z.string().optional(),
    rootPath: z.string().optional(),
    projectInstructions: z.string().optional(),
    defaultProviderId: z.string().min(1).nullable().optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.rootPath !== undefined ||
      value.projectInstructions !== undefined ||
      value.defaultProviderId !== undefined,
    "At least one field must be provided",
  );
export type UpdateProjectRequest = z.infer<
  typeof updateProjectRequestSchema
>;

export const threadOperationTypeSchema = z.enum(["commit", "squash_merge"]);
export type ThreadOperationType = z.infer<typeof threadOperationTypeSchema>;

export const commitOperationOptionsSchema = z.object({
  message: z.string().min(1).optional(),
  includeUnstaged: z.boolean().optional(),
  autoArchiveOnSuccess: z.boolean().optional(),
});
export type CommitOperationOptions = z.infer<
  typeof commitOperationOptionsSchema
>;

export const squashMergeOperationOptionsSchema = z.object({
  commitIfNeeded: z.boolean().optional(),
  includeUnstaged: z.boolean().optional(),
  commitMessage: z.string().min(1).optional(),
  squashMessage: z.string().min(1).optional(),
  mergeBaseBranch: z.string().min(1).optional(),
  autoArchiveOnSuccess: z.boolean().optional(),
});
export type SquashMergeOperationOptions = z.infer<
  typeof squashMergeOperationOptionsSchema
>;

export const threadOperationRequestSchema = z.discriminatedUnion("operation", [
  z.object({
    operation: z.literal("commit"),
    options: commitOperationOptionsSchema.optional(),
  }),
  z.object({
    operation: z.literal("squash_merge"),
    options: squashMergeOperationOptionsSchema.optional(),
  }),
]);
export type ThreadOperationRequest = z.infer<
  typeof threadOperationRequestSchema
>;

export const environmentOperationTypeSchema = z.enum([
  "promote_primary",
  "demote_primary",
  "commit",
  "squash_merge",
]);
export type EnvironmentOperationType = z.infer<
  typeof environmentOperationTypeSchema
>;

const promotePrimaryEnvironmentOperationRequestSchema = z.object({
  operation: z.literal("promote_primary"),
  initiatingThreadId: z.string().min(1),
});

const demotePrimaryEnvironmentOperationRequestSchema = z.object({
  operation: z.literal("demote_primary"),
  initiatingThreadId: z.string().min(1),
});

const commitEnvironmentOperationRequestSchema = z.object({
  operation: z.literal("commit"),
  initiatingThreadId: z.string().min(1),
  options: commitOperationOptionsSchema.optional(),
});

const squashMergeEnvironmentOperationRequestSchema = z.object({
  operation: z.literal("squash_merge"),
  initiatingThreadId: z.string().min(1),
  options: squashMergeOperationOptionsSchema.optional(),
});

export const environmentOperationRequestSchema = z.discriminatedUnion("operation", [
  promotePrimaryEnvironmentOperationRequestSchema,
  demotePrimaryEnvironmentOperationRequestSchema,
  commitEnvironmentOperationRequestSchema,
  squashMergeEnvironmentOperationRequestSchema,
]);
export type EnvironmentOperationRequest = z.infer<
  typeof environmentOperationRequestSchema
>;

export const environmentOperationPrepCommitResultSchema = z.object({
  message: z.string(),
  commitSha: z.string().optional(),
  commitSubject: z.string().optional(),
  includeUnstaged: z.boolean().optional(),
});
export type EnvironmentOperationPrepCommitResult = z.infer<
  typeof environmentOperationPrepCommitResultSchema
>;

export const commitEnvironmentOperationResponseSchema = z.object({
  ok: z.literal(true),
  operation: z.literal("commit"),
  commitCreated: z.boolean(),
  message: z.string(),
  autoArchived: z.boolean(),
  commitSha: z.string().optional(),
  commitSubject: z.string().optional(),
  includeUnstaged: z.boolean().optional(),
});
export type CommitEnvironmentOperationResponse = z.infer<
  typeof commitEnvironmentOperationResponseSchema
>;

export const squashMergeEnvironmentOperationResponseSchema = z.object({
  ok: z.literal(true),
  operation: z.literal("squash_merge"),
  merged: z.boolean(),
  message: z.string(),
  autoArchived: z.boolean(),
  committed: z.boolean().optional(),
  commitSha: z.string().optional(),
  commitSubject: z.string().optional(),
  prepCommit: environmentOperationPrepCommitResultSchema.optional(),
});
export type SquashMergeEnvironmentOperationResponse = z.infer<
  typeof squashMergeEnvironmentOperationResponseSchema
>;

export const commitFailureEnvironmentOperationDetailsSchema = z.object({
  operation: z.literal("commit"),
  kind: z.literal("commit_failed"),
  request: commitEnvironmentOperationRequestSchema,
  errorMessage: z.string(),
});
export type CommitFailureEnvironmentOperationDetails = z.infer<
  typeof commitFailureEnvironmentOperationDetailsSchema
>;

export const squashMergeConflictEnvironmentOperationDetailsSchema = z.object({
  operation: z.literal("squash_merge"),
  kind: z.literal("squash_merge_conflict"),
  request: squashMergeEnvironmentOperationRequestSchema,
  conflictFiles: z.array(z.string()),
});
export type SquashMergeConflictEnvironmentOperationDetails = z.infer<
  typeof squashMergeConflictEnvironmentOperationDetailsSchema
>;

export const squashMergeCommitFailureEnvironmentOperationDetailsSchema =
  z.object({
    operation: z.literal("squash_merge"),
    kind: z.literal("squash_merge_commit_failed"),
    request: squashMergeEnvironmentOperationRequestSchema,
    stage: z.enum(["prep_commit", "squash_commit"]),
    errorMessage: z.string(),
  });
export type SquashMergeCommitFailureEnvironmentOperationDetails = z.infer<
  typeof squashMergeCommitFailureEnvironmentOperationDetailsSchema
>;

export const environmentOperationFailureDetailsSchema = z.discriminatedUnion(
  "kind",
  [
    commitFailureEnvironmentOperationDetailsSchema,
    squashMergeConflictEnvironmentOperationDetailsSchema,
    squashMergeCommitFailureEnvironmentOperationDetailsSchema,
  ],
);
export type EnvironmentOperationFailureDetails = z.infer<
  typeof environmentOperationFailureDetailsSchema
>;

export const primaryCheckoutStatusSchema = z.object({
  projectId: z.string(),
  activeEnvironmentId: z.string().optional(),
  activeThreadId: z.string().optional(),
  promotedAt: z.number().optional(),
});
export type PrimaryCheckoutStatus = z.infer<
  typeof primaryCheckoutStatusSchema
>;

export const promotePrimaryCheckoutResponseSchema = z.object({
  ok: z.literal(true),
  promoted: z.boolean(),
  message: z.string(),
  primaryStatus: primaryCheckoutStatusSchema,
});
export type PromotePrimaryCheckoutResponse = z.infer<
  typeof promotePrimaryCheckoutResponseSchema
>;

export const demotePrimaryCheckoutResponseSchema = z.object({
  ok: z.literal(true),
  demoted: z.boolean(),
  message: z.string(),
  primaryStatus: primaryCheckoutStatusSchema,
});
export type DemotePrimaryCheckoutResponse = z.infer<
  typeof demotePrimaryCheckoutResponseSchema
>;

export const environmentOperationResponseSchema = z.discriminatedUnion(
  "operation",
  [
    commitEnvironmentOperationResponseSchema,
    squashMergeEnvironmentOperationResponseSchema,
    promotePrimaryCheckoutResponseSchema.extend({
      operation: z.literal("promote_primary"),
    }),
    demotePrimaryCheckoutResponseSchema.extend({
      operation: z.literal("demote_primary"),
    }),
  ],
);
export type EnvironmentOperationResponse = z.infer<
  typeof environmentOperationResponseSchema
>;

export const projectFileSuggestionSchema = z.object({
  path: z.string(),
});
export type ProjectFileSuggestion = z.infer<
  typeof projectFileSuggestionSchema
>;

export const promptMentionSuggestionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file"),
    path: z.string(),
    replacement: z.string(),
  }),
  z.object({
    kind: z.literal("thread"),
    path: z.string(),
    replacement: z.string(),
    threadId: z.string(),
    title: z.string().optional(),
    threadType: threadTypeSchema,
  }),
]);
export type PromptMentionSuggestion = z.infer<
  typeof promptMentionSuggestionSchema
>;

export const uploadedPromptAttachmentSchema = z.object({
  type: z.enum(["localImage", "localFile"]),
  path: z.string(),
  name: z.string(),
  mimeType: z.string().optional(),
  sizeBytes: z.number(),
});
export type UploadedPromptAttachment = z.infer<
  typeof uploadedPromptAttachmentSchema
>;

export const openPathTargetSchema = z.enum(["file", "directory"]);
export type OpenPathTarget = z.infer<typeof openPathTargetSchema>;

export const openPathEditorSchema = z.enum([
  "system_default",
  "vscode",
  "cursor",
  "zed",
  "windsurf",
]);
export type OpenPathEditor = z.infer<typeof openPathEditorSchema>;

export const openPathRequestSchema = z.object({
  path: z.string(),
  target: openPathTargetSchema.optional(),
  editor: openPathEditorSchema.optional(),
  command: z.string().optional(),
});
export type OpenPathRequest = z.infer<typeof openPathRequestSchema>;

export const openThreadPathRequestSchema = z.object({
  relativePath: z.string(),
  target: openPathTargetSchema.optional(),
  editor: openPathEditorSchema.optional(),
  command: z.string().optional(),
});
export type OpenThreadPathRequest = z.infer<
  typeof openThreadPathRequestSchema
>;

export const systemStatusSchema = z.object({
  runningThreads: z.number(),
  totalThreads: z.number(),
  uptime: z.number(),
});
export type SystemStatus = z.infer<typeof systemStatusSchema>;

export const systemHealthStorageBucketKeySchema = z.enum([
  "database",
  "database_wal",
  "database_shm",
  "server_logs",
  "environment_daemon_logs",
  "worktrees",
  "attachments",
  "backups",
]);
export type SystemHealthStorageBucketKey = z.infer<
  typeof systemHealthStorageBucketKeySchema
>;

export const systemHealthStorageBucketSchema = z.object({
  key: systemHealthStorageBucketKeySchema,
  label: z.string(),
  bytes: z.number(),
  paths: z.array(z.string()),
});
export type SystemHealthStorageBucket = z.infer<
  typeof systemHealthStorageBucketSchema
>;

export const systemHealthDiskSummarySchema = z.object({
  path: z.string(),
  availableBytes: z.number(),
  totalBytes: z.number(),
  usedBytes: z.number(),
});
export type SystemHealthDiskSummary = z.infer<
  typeof systemHealthDiskSummarySchema
>;

export const systemHealthThreadCountsSchema = z.object({
  total: z.number(),
  archived: z.number(),
  created: z.number(),
  provisioning: z.number(),
  provisioned: z.number(),
  provisioningFailed: z.number(),
  error: z.number(),
  active: z.number(),
  idle: z.number(),
});
export type SystemHealthThreadCounts = z.infer<
  typeof systemHealthThreadCountsSchema
>;

export const systemHealthEnvironmentDaemonWorkerSchema = z.object({
  name: z.string(),
  version: z.string(),
  buildId: z.string().optional(),
});
export type SystemHealthEnvironmentDaemonWorker = z.infer<
  typeof systemHealthEnvironmentDaemonWorkerSchema
>;

export const systemHealthEnvironmentDaemonProviderSchema = z.object({
  providerId: z.string(),
  adapterVersion: z.string(),
  runtimeVersion: z.string().optional(),
});
export type SystemHealthEnvironmentDaemonProvider = z.infer<
  typeof systemHealthEnvironmentDaemonProviderSchema
>;

export const systemHealthEnvironmentDaemonCapabilitiesSchema = z.object({
  commands: z.array(z.string()),
  features: z.array(z.string()),
});
export type SystemHealthEnvironmentDaemonCapabilities = z.infer<
  typeof systemHealthEnvironmentDaemonCapabilitiesSchema
>;

export const systemHealthEnvironmentDaemonCompatibilitySchema = z.object({
  disposition: z.enum(["reuse", "degrade", "replace"]),
  missingRequiredCommands: z.array(z.string()),
  missingOptionalCommands: z.array(z.string()),
  missingOptionalFeatures: z.array(z.string()),
});
export type SystemHealthEnvironmentDaemonCompatibility = z.infer<
  typeof systemHealthEnvironmentDaemonCompatibilitySchema
>;

export const systemHealthEnvironmentDaemonSessionSchema = z.object({
  sessionId: z.string(),
  environmentId: z.string(),
  environmentDaemonId: z.string(),
  environmentDaemonInstanceId: z.string(),
  protocolVersion: z.number(),
  worker: systemHealthEnvironmentDaemonWorkerSchema.optional(),
  providers: z.array(systemHealthEnvironmentDaemonProviderSchema).optional(),
  selectedCapabilities:
    systemHealthEnvironmentDaemonCapabilitiesSchema.optional(),
  compatibility: systemHealthEnvironmentDaemonCompatibilitySchema.optional(),
  controlBaseUrl: z.string().optional(),
  leaseExpiresAt: z.number(),
  lastHeartbeatAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type SystemHealthEnvironmentDaemonSession = z.infer<
  typeof systemHealthEnvironmentDaemonSessionSchema
>;

export const systemHealthReportSchema = z.object({
  generatedAt: z.number(),
  uptime: z.number(),
  projectCount: z.number(),
  runningThreads: z.number(),
  threadCounts: systemHealthThreadCountsSchema,
  environmentDaemon: z.object({
    activeSessionCount: z.number(),
    activeSessions: z.array(systemHealthEnvironmentDaemonSessionSchema),
  }),
  storage: z.object({
    totalBytes: z.number(),
    disk: systemHealthDiskSummarySchema.optional(),
    buckets: z.array(systemHealthStorageBucketSchema),
  }),
});
export type SystemHealthReport = z.infer<typeof systemHealthReportSchema>;

export const systemRestartActionSchema = z.enum(["noop"]);
export type SystemRestartAction = z.infer<typeof systemRestartActionSchema>;

export const serverRuntimeModeSchema = z.enum(["development", "production"]);
export type ServerRuntimeMode = z.infer<typeof serverRuntimeModeSchema>;

export const systemRestartPolicySchema = z.object({
  runtimeMode: serverRuntimeModeSchema,
  restartPolicyByStatus: z.object({
    created: systemRestartActionSchema,
    provisioning: systemRestartActionSchema,
    provisioned: systemRestartActionSchema,
    provisioning_failed: systemRestartActionSchema,
    error: systemRestartActionSchema,
    idle: systemRestartActionSchema,
    active: systemRestartActionSchema,
  }),
  shutdownBlockingStatuses: z.array(threadStatusSchema),
  shouldRestart: z.boolean(),
});
export type SystemRestartPolicy = z.infer<
  typeof systemRestartPolicySchema
>;

export const systemShutdownRequestSchema = z.object({
  force: z.boolean().optional(),
});
export type SystemShutdownRequest = z.infer<
  typeof systemShutdownRequestSchema
>;

export const systemRestartRequestSchema = z.object({
  force: z.boolean().optional(),
});
export type SystemRestartRequest = z.infer<
  typeof systemRestartRequestSchema
>;

export const systemShutdownAcceptedResponseSchema = z.object({
  ok: z.literal(true),
  forced: z.boolean(),
  blockingThreadsCount: z.number(),
});
export type SystemShutdownAcceptedResponse = z.infer<
  typeof systemShutdownAcceptedResponseSchema
>;

export const systemRestartAcceptedResponseSchema =
  systemShutdownAcceptedResponseSchema.extend({
    restarting: z.literal(true),
  });
export type SystemRestartAcceptedResponse = z.infer<
  typeof systemRestartAcceptedResponseSchema
>;

export const systemShutdownBlockingThreadSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  status: threadStatusSchema,
});
export type SystemShutdownBlockingThread = z.infer<
  typeof systemShutdownBlockingThreadSchema
>;

export const systemShutdownBlockedResponseSchema = z.object({
  code: z.literal("shutdown_blocked"),
  message: z.string(),
  blockingThreads: z.array(systemShutdownBlockingThreadSchema),
});
export type SystemShutdownBlockedResponse = z.infer<
  typeof systemShutdownBlockedResponseSchema
>;

export const systemProviderInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  capabilities: providerCapabilitiesSchema,
});
export type SystemProviderInfo = z.infer<typeof systemProviderInfoSchema>;

export const systemEnvironmentInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
});
export type SystemEnvironmentInfo = z.infer<
  typeof systemEnvironmentInfoSchema
>;

export const threadToolGroupMessagesRequestSchema = z.object({
  turnId: z.string(),
  sourceSeqStart: z.number(),
  sourceSeqEnd: z.number(),
  includeManagerDebugView: z.boolean().optional(),
});
export type ThreadToolGroupMessagesRequest = z.infer<
  typeof threadToolGroupMessagesRequestSchema
>;

export const threadToolGroupMessagesResponseSchema = z.object({
  messages: z.array(z.unknown()),
});
export type ThreadToolGroupMessagesResponse = z.infer<
  typeof threadToolGroupMessagesResponseSchema
>;

export const threadTimelineResponseSchema = z.object({
  rows: z.array(z.unknown()),
  contextWindowUsage: threadContextWindowUsageSchema.nullable().optional(),
});
export type ThreadTimelineResponse = z.infer<
  typeof threadTimelineResponseSchema
>;

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

const environmentOperationNotAvailableSchema = z.object({
  error: z.string(),
});

export type PublicApiSchema = {
  "/projects": {
    $get: Endpoint<EmptyInput, Project[]>;
    $post: Endpoint<{ json: CreateProjectRequest }, Project, 201>;
  };
  "/projects/:id": {
    $get: Endpoint<PathProjectId, Project>;
    $patch: Endpoint<PathProjectId & { json: UpdateProjectRequest }, Project>;
    $delete: Endpoint<PathProjectId, { ok: true }>;
  };
  "/projects/:id/manager": {
    $post: Endpoint<
      PathProjectId & {
        json: {
          title?: string;
          providerId?: string;
          model?: string;
          reasoningLevel?: "low" | "medium" | "high" | "xhigh";
        };
      },
      Thread,
      201
    >;
  };
  "/projects/:id/files": {
    $get: Endpoint<
      PathProjectId & { query: { query?: string; limit?: string } },
      ProjectFileSuggestion[]
    >;
  };
  "/projects/:id/workspace-status": {
    $get: Endpoint<PathProjectId, ThreadWorkStatus>;
  };
  "/projects/:id/attachments": {
    $post: Endpoint<
      PathProjectId & { form: Record<string, string | Blob> },
      UploadedPromptAttachment,
      201
    >;
  };
  "/projects/:id/attachments/content": {
    $get: Endpoint<
      PathProjectId & { query: { path: string } },
      string,
      200,
      "text"
    >;
  };
  "/environments": {
    $get: Endpoint<{ query?: { projectId?: string } }, EnvironmentRecord[]>;
  };
  "/environments/:id": {
    $get: Endpoint<PathId, EnvironmentRecord | null, 200 | 404>;
  };
  "/environments/:id/operations": {
    $post: Endpoint<
      PathId & { json: EnvironmentOperationRequest },
      EnvironmentOperationResponse | z.infer<typeof environmentOperationNotAvailableSchema> | null,
      200 | 404
    >;
  };
  "/environments/:id/env-daemon/status": {
    $get: Endpoint<PathId, unknown>;
  };
  "/environments/:id/env-daemon/sessions": {
    $get: Endpoint<PathId, unknown>;
  };
  "/threads": {
    $get: Endpoint<
      {
        query?: {
          projectId?: string;
          type?: ThreadType;
          parentThreadId?: string;
          includeArchived?: "true" | "false";
          includeWorkStatus?: "true" | "false";
        };
      },
      Thread[]
    >;
    $post: Endpoint<{ json: SpawnThreadRequest }, Thread, 201>;
  };
  "/threads/:id": {
    $get: Endpoint<PathId, Thread>;
    $patch: Endpoint<PathId & { json: UpdateThreadRequest }, Thread>;
    $delete: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/open-path": {
    $post: Endpoint<PathId & { json: OpenThreadPathRequest }, { ok: true }>;
  };
  "/threads/:id/default-execution-options": {
    $get: Endpoint<PathId, ThreadExecutionOptions | null>;
  };
  "/threads/:id/manager-workspace/files": {
    $get: Endpoint<PathId, { files: Array<{ path: string; size: number }> }>;
  };
  "/threads/:id/manager-workspace/file": {
    $get: Endpoint<PathId & { query: { path: string } }, { path: string; content: string }>;
  };
  "/threads/:id/env-daemon/status": {
    $get: Endpoint<PathId, unknown>;
  };
  "/threads/:id/env-daemon/sessions": {
    $get: Endpoint<PathId, unknown>;
  };
  "/threads/:id/tell": {
    $post: Endpoint<PathId & { json: TellThreadRequest }, { ok: true }>;
  };
  "/threads/:id/queue": {
    $post: Endpoint<PathId & { json: EnqueueThreadMessageRequest }, ThreadQueuedMessage, 201>;
  };
  "/threads/:id/queue/:queuedMessageId/send": {
    $post: Endpoint<
      PathThreadAndQueued & { json: SendQueuedThreadMessageRequest },
      SendQueuedThreadMessageResponse
    >;
  };
  "/threads/:id/queue/:queuedMessageId": {
    $delete: Endpoint<PathThreadAndQueued, { ok: true }>;
  };
  "/threads/:id/stop": {
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/archive": {
    $post: Endpoint<PathId & { json: { force?: boolean } }, { ok: true }>;
  };
  "/threads/:id/unarchive": {
    $post: Endpoint<PathId, { ok: true }>;
  };
  "/threads/:id/read": {
    $post: Endpoint<PathId, Thread>;
  };
  "/threads/:id/unread": {
    $post: Endpoint<PathId, Thread>;
  };
  "/threads/:id/work-status": {
    $get: Endpoint<PathId & { query?: { mergeBaseBranch?: string } }, ThreadWorkStatus | null>;
  };
  "/threads/:id/merge-base-branches": {
    $get: Endpoint<PathId, string[]>;
  };
  "/threads/:id/primary-status": {
    $get: Endpoint<PathId, PrimaryCheckoutStatus>;
  };
  "/threads/:id/timeline": {
    $get: Endpoint<
      PathId & {
        query?: {
          limit?: string;
          includeToolGroupMessages?: "true" | "false";
          includeManagerDebugView?: "true" | "false";
        };
      },
      ThreadTimelineResponse
    >;
  };
  "/threads/:id/tool-group-messages": {
    $get: Endpoint<
      PathId & {
        query: {
          turnId: string;
          sourceSeqStart: string;
          sourceSeqEnd: string;
          includeManagerDebugView?: "true" | "false";
        };
      },
      ThreadToolGroupMessagesResponse
    >;
  };
  "/threads/:id/git-diff": {
    $get: Endpoint<
      PathId & {
        query?: {
          selection?: "combined" | "commit";
          commitSha?: string;
          mergeBaseBranch?: string;
        };
      },
      ThreadGitDiffResponse
    >;
  };
  "/threads/:id/events": {
    $get: Endpoint<PathId & { query?: { afterSeq?: string; limit?: string } }, ThreadEventRow[]>;
  };
  "/threads/:id/output": {
    $get: Endpoint<PathId, { output: string | null }>;
  };
  "/system/status": {
    $get: Endpoint<EmptyInput, SystemStatus>;
  };
  "/system/health": {
    $get: Endpoint<EmptyInput, SystemHealthReport>;
  };
  "/system/models": {
    $get: Endpoint<
      { query?: { providerId?: string; environmentId?: string } },
      AvailableModel[]
    >;
  };
  "/system/provider": {
    $get: Endpoint<{ query?: { environmentId?: string } }, SystemProviderInfo>;
  };
  "/system/providers": {
    $get: Endpoint<{ query?: { environmentId?: string } }, SystemProviderInfo[]>;
  };
  "/system/environments": {
    $get: Endpoint<EmptyInput, SystemEnvironmentInfo[]>;
  };
  "/system/restart-policy": {
    $get: Endpoint<EmptyInput, SystemRestartPolicy>;
  };
  "/system/shutdown": {
    $post:
      | Endpoint<{ json: SystemShutdownRequest }, SystemShutdownAcceptedResponse, 200>
      | Endpoint<{ json: SystemShutdownRequest }, SystemShutdownBlockedResponse, 409>;
  };
  "/system/restart": {
    $post:
      | Endpoint<{ json: SystemRestartRequest }, SystemRestartAcceptedResponse, 200>
      | Endpoint<{ json: SystemRestartRequest }, SystemShutdownBlockedResponse, 409>;
  };
  "/system/pick-folder": {
    $post: Endpoint<EmptyInput, { path: string | null }>;
  };
  "/system/open-path": {
    $post: Endpoint<{ json: OpenPathRequest }, { ok: true }>;
  };
  "/system/voice-transcription": {
    $post: Endpoint<{ form: Record<string, string | Blob> }, unknown>;
  };
};

export type PublicApiRoutes = Hono<{}, PublicApiSchema, "/">;

export function createPublicApiClient(baseUrl: string) {
  return hc<PublicApiRoutes>(`${baseUrl}/api/v1`);
}

export function createApiClient(baseUrl: string) {
  const apiClient = createPublicApiClient(baseUrl);
  return {
    api: {
      v1: apiClient,
    },
  };
}

export type ApiClient = ReturnType<typeof createApiClient>;
