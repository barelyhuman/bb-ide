import { z } from "zod";

export const lifecycleOperationStateValues = [
  "requested",
  "queued",
  "completed",
  "failed",
  "cancelled",
] as const;
export const lifecycleOperationStateSchema = z.enum(
  lifecycleOperationStateValues,
);
export type LifecycleOperationState = z.infer<
  typeof lifecycleOperationStateSchema
>;

export const activeLifecycleOperationStates = [
  "requested",
  "queued",
] as const satisfies readonly LifecycleOperationState[];

export function isActiveLifecycleOperationState(
  state: LifecycleOperationState,
): boolean {
  return state === "requested" || state === "queued";
}

export const environmentOperationKindValues = [
  "provision",
  "reprovision",
  "destroy",
] as const;
export const environmentOperationKindSchema = z.enum(
  environmentOperationKindValues,
);
export type EnvironmentOperationKind = z.infer<
  typeof environmentOperationKindSchema
>;

export const threadOperationKindValues = [
  "provision",
  "start",
  "stop",
] as const;
export const threadOperationKindSchema = z.enum(threadOperationKindValues);
export type ThreadOperationKind = z.infer<typeof threadOperationKindSchema>;

export const threadProvisioningStageValues = [
  "metadata-pending",
  "environment-pending",
  "environment-attached",
  "environment-provisioning",
  "workspace-ready",
] as const;
export const threadProvisioningStageSchema = z.enum(
  threadProvisioningStageValues,
);
export type ThreadProvisioningStage = z.infer<
  typeof threadProvisioningStageSchema
>;

export interface ThreadProvisioningState {
  environmentId: string | null;
  provisionEventSequence: number | null;
  provisioningId: string;
  stage: ThreadProvisioningStage;
  workspaceReadyEventSequence: number | null;
}

export const projectOperationKindValues = ["delete"] as const;
export const projectOperationKindSchema = z.enum(projectOperationKindValues);
export type ProjectOperationKind = z.infer<typeof projectOperationKindSchema>;

export const hostOperationKindValues = ["sync_runtime_material"] as const;
export const hostOperationKindSchema = z.enum(hostOperationKindValues);
export type HostOperationKind = z.infer<typeof hostOperationKindSchema>;
