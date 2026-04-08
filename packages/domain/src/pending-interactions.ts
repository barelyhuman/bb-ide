import { z } from "zod";

export const pendingInteractionKindSchema = z.enum([
  "command_approval",
  "file_change_approval",
  "permission_request",
  "user_input_request",
]);
export type PendingInteractionKind = z.infer<
  typeof pendingInteractionKindSchema
>;

export const pendingInteractionStatusSchema = z.enum([
  "pending",
  "resolved",
  "rejected",
  "interrupted",
  "expired",
]);
export type PendingInteractionStatus = z.infer<
  typeof pendingInteractionStatusSchema
>;

export const pendingInteractionCommandActionSchema = z.discriminatedUnion(
  "type",
  [
    z.object({
      type: z.literal("read"),
      command: z.string(),
      name: z.string(),
      path: z.string(),
    }),
    z.object({
      type: z.literal("listFiles"),
      command: z.string(),
      path: z.string().nullable(),
    }),
    z.object({
      type: z.literal("search"),
      command: z.string(),
      query: z.string().nullable(),
      path: z.string().nullable(),
    }),
    z.object({
      type: z.literal("unknown"),
      command: z.string(),
    }),
  ],
);
export type PendingInteractionCommandAction = z.infer<
  typeof pendingInteractionCommandActionSchema
>;

export const pendingInteractionNetworkPermissionsSchema = z.object({
  enabled: z.boolean().nullable(),
});
export type PendingInteractionNetworkPermissions = z.infer<
  typeof pendingInteractionNetworkPermissionsSchema
>;

export const pendingInteractionFileSystemPermissionsSchema = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
});
export type PendingInteractionFileSystemPermissions = z.infer<
  typeof pendingInteractionFileSystemPermissionsSchema
>;

export const pendingInteractionRequestedPermissionProfileSchema = z.object({
  network: pendingInteractionNetworkPermissionsSchema.nullable(),
  fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
});
export type PendingInteractionRequestedPermissionProfile = z.infer<
  typeof pendingInteractionRequestedPermissionProfileSchema
>;

export const pendingInteractionGrantedPermissionProfileSchema = z.object({
  network: pendingInteractionNetworkPermissionsSchema.nullable(),
  fileSystem: pendingInteractionFileSystemPermissionsSchema.nullable(),
});
export type PendingInteractionGrantedPermissionProfile = z.infer<
  typeof pendingInteractionGrantedPermissionProfileSchema
>;

export const pendingInteractionCommandApprovalDecisionSchema = z.enum([
  "accept",
  "accept_for_session",
  "decline",
  "cancel",
]);
export type PendingInteractionCommandApprovalDecision = z.infer<
  typeof pendingInteractionCommandApprovalDecisionSchema
>;

export const pendingInteractionFileChangeApprovalDecisionSchema = z.enum([
  "accept",
  "accept_for_session",
  "decline",
  "cancel",
]);
export type PendingInteractionFileChangeApprovalDecision = z.infer<
  typeof pendingInteractionFileChangeApprovalDecisionSchema
>;

export const pendingInteractionPermissionGrantScopeSchema = z.enum([
  "turn",
  "session",
]);
export type PendingInteractionPermissionGrantScope = z.infer<
  typeof pendingInteractionPermissionGrantScopeSchema
>;

export const pendingInteractionQuestionOptionSchema = z.object({
  label: z.string(),
  description: z.string(),
});
export type PendingInteractionQuestionOption = z.infer<
  typeof pendingInteractionQuestionOptionSchema
>;

export const pendingInteractionUserInputQuestionSchema = z.object({
  id: z.string(),
  header: z.string(),
  question: z.string(),
  allowsOther: z.boolean(),
  isSecret: z.boolean(),
  options: z.array(pendingInteractionQuestionOptionSchema),
});
export type PendingInteractionUserInputQuestion = z.infer<
  typeof pendingInteractionUserInputQuestionSchema
>;

export const commandApprovalPendingInteractionPayloadSchema = z.object({
  kind: z.literal("command_approval"),
  itemId: z.string().min(1),
  approvalId: z.string().nullable(),
  reason: z.string().nullable(),
  command: z.string().nullable(),
  cwd: z.string().nullable(),
  commandActions: z.array(pendingInteractionCommandActionSchema),
  requestedPermissions: pendingInteractionRequestedPermissionProfileSchema.nullable(),
  availableDecisions: z.array(pendingInteractionCommandApprovalDecisionSchema),
});
export type CommandApprovalPendingInteractionPayload = z.infer<
  typeof commandApprovalPendingInteractionPayloadSchema
>;

export const fileChangeApprovalPendingInteractionPayloadSchema = z.object({
  kind: z.literal("file_change_approval"),
  itemId: z.string().min(1),
  reason: z.string().nullable(),
  grantRoot: z.string().nullable(),
});
export type FileChangeApprovalPendingInteractionPayload = z.infer<
  typeof fileChangeApprovalPendingInteractionPayloadSchema
>;

export const permissionRequestPendingInteractionPayloadSchema = z.object({
  kind: z.literal("permission_request"),
  itemId: z.string().min(1),
  reason: z.string().nullable(),
  permissions: pendingInteractionRequestedPermissionProfileSchema,
});
export type PermissionRequestPendingInteractionPayload = z.infer<
  typeof permissionRequestPendingInteractionPayloadSchema
>;

export const userInputRequestPendingInteractionPayloadSchema = z.object({
  kind: z.literal("user_input_request"),
  itemId: z.string().min(1),
  questions: z.array(pendingInteractionUserInputQuestionSchema),
});
export type UserInputRequestPendingInteractionPayload = z.infer<
  typeof userInputRequestPendingInteractionPayloadSchema
>;

export const pendingInteractionPayloadSchema = z.discriminatedUnion("kind", [
  commandApprovalPendingInteractionPayloadSchema,
  fileChangeApprovalPendingInteractionPayloadSchema,
  permissionRequestPendingInteractionPayloadSchema,
  userInputRequestPendingInteractionPayloadSchema,
]);
export type PendingInteractionPayload = z.infer<
  typeof pendingInteractionPayloadSchema
>;

export const commandApprovalPendingInteractionResolutionSchema = z.object({
  kind: z.literal("command_approval"),
  decision: pendingInteractionCommandApprovalDecisionSchema,
});
export type CommandApprovalPendingInteractionResolution = z.infer<
  typeof commandApprovalPendingInteractionResolutionSchema
>;

export const fileChangeApprovalPendingInteractionResolutionSchema = z.object({
  kind: z.literal("file_change_approval"),
  decision: pendingInteractionFileChangeApprovalDecisionSchema,
});
export type FileChangeApprovalPendingInteractionResolution = z.infer<
  typeof fileChangeApprovalPendingInteractionResolutionSchema
>;

export const permissionRequestPendingInteractionResolutionSchema = z.object({
  kind: z.literal("permission_request"),
  permissions: pendingInteractionGrantedPermissionProfileSchema,
  scope: pendingInteractionPermissionGrantScopeSchema,
});
export type PermissionRequestPendingInteractionResolution = z.infer<
  typeof permissionRequestPendingInteractionResolutionSchema
>;

export const userInputRequestPendingInteractionResolutionSchema = z.object({
  kind: z.literal("user_input_request"),
  answers: z.record(z.string(), z.array(z.string())),
});
export type UserInputRequestPendingInteractionResolution = z.infer<
  typeof userInputRequestPendingInteractionResolutionSchema
>;

export const pendingInteractionResolutionSchema = z.discriminatedUnion("kind", [
  commandApprovalPendingInteractionResolutionSchema,
  fileChangeApprovalPendingInteractionResolutionSchema,
  permissionRequestPendingInteractionResolutionSchema,
  userInputRequestPendingInteractionResolutionSchema,
]);
export type PendingInteractionResolution = z.infer<
  typeof pendingInteractionResolutionSchema
>;

export const pendingInteractionCreateSchema = z.object({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  providerRequestMethod: z.string().min(1),
  payload: pendingInteractionPayloadSchema,
});
export type PendingInteractionCreate = z.infer<
  typeof pendingInteractionCreateSchema
>;

export const pendingInteractionSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  turnId: z.string().min(1),
  providerId: z.string().min(1),
  providerThreadId: z.string().min(1),
  providerRequestId: z.string().min(1),
  providerRequestMethod: z.string().min(1),
  status: pendingInteractionStatusSchema,
  payload: pendingInteractionPayloadSchema,
  resolution: pendingInteractionResolutionSchema.nullable(),
  statusReason: z.string().nullable(),
  createdAt: z.number().int().nonnegative(),
  resolvedAt: z.number().int().nonnegative().nullable(),
}).superRefine((value, context) => {
  if (value.resolution !== null && value.resolution.kind !== value.payload.kind) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "resolution kind must match payload kind",
      path: ["resolution", "kind"],
    });
  }
});
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;
