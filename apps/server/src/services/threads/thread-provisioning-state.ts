import { z } from "zod";
import type {
  ThreadProvisioningStage,
  ThreadProvisioningState,
} from "@bb/domain";

const threadProvisioningStateBaseRecordSchema = z.object({
  provisioningId: z.string().min(1),
});

const metadataPendingStateRecordSchema =
  threadProvisioningStateBaseRecordSchema.extend({
    provisionEventSequence: z.null(),
    provisioningEnvironmentId: z.null(),
    provisioningStage: z.literal("metadata-pending"),
    workspaceReadyEventSequence: z.null(),
  });

const environmentPendingStateRecordSchema =
  threadProvisioningStateBaseRecordSchema.extend({
    provisionEventSequence: z.null(),
    provisioningEnvironmentId: z.null(),
    provisioningStage: z.literal("environment-pending"),
    workspaceReadyEventSequence: z.null(),
  });

const environmentAttachedStateRecordSchema =
  threadProvisioningStateBaseRecordSchema.extend({
    provisionEventSequence: z.null(),
    provisioningEnvironmentId: z.string().min(1),
    provisioningStage: z.literal("environment-attached"),
    workspaceReadyEventSequence: z.null(),
  });

const environmentProvisioningStateRecordSchema =
  threadProvisioningStateBaseRecordSchema.extend({
    provisionEventSequence: z.number().int().nonnegative(),
    provisioningEnvironmentId: z.string().min(1),
    provisioningStage: z.literal("environment-provisioning"),
    workspaceReadyEventSequence: z.null(),
  });

const workspaceReadyStateRecordSchema =
  threadProvisioningStateBaseRecordSchema.extend({
    provisionEventSequence: z.number().int().nonnegative().nullable(),
    provisioningEnvironmentId: z.string().min(1),
    provisioningStage: z.literal("workspace-ready"),
    workspaceReadyEventSequence: z.number().int().nonnegative(),
  });

const threadProvisioningStateRecordSchema = z.discriminatedUnion(
  "provisioningStage",
  [
    metadataPendingStateRecordSchema,
    environmentPendingStateRecordSchema,
    environmentAttachedStateRecordSchema,
    environmentProvisioningStateRecordSchema,
    workspaceReadyStateRecordSchema,
  ],
);

export interface ThreadProvisioningStateRecord {
  provisionEventSequence: number | null;
  provisioningEnvironmentId: string | null;
  provisioningId: string | null;
  provisioningStage: ThreadProvisioningStage | null;
  workspaceReadyEventSequence: number | null;
}

export function readThreadProvisioningStateFromRecord(
  record: ThreadProvisioningStateRecord,
): ThreadProvisioningState {
  const parsed = threadProvisioningStateRecordSchema.parse(record);

  return {
    environmentId: parsed.provisioningEnvironmentId,
    provisionEventSequence: parsed.provisionEventSequence,
    provisioningId: parsed.provisioningId,
    stage: parsed.provisioningStage,
    workspaceReadyEventSequence: parsed.workspaceReadyEventSequence,
  };
}

export function readThreadProvisioningIdFromRecord(
  record: ThreadProvisioningStateRecord,
): string {
  return readThreadProvisioningStateFromRecord(record).provisioningId;
}
