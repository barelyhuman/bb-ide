import { z } from "zod";

export const sandboxBackendCapabilitiesSchema = z.object({
  supportsManagedClone: z.boolean(),
  supportsManagedWorktree: z.boolean(),
  supportsSuspend: z.boolean(),
});
export type SandboxBackendCapabilities = z.infer<
  typeof sandboxBackendCapabilitiesSchema
>;

export const sandboxBackendInfoSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  capabilities: sandboxBackendCapabilitiesSchema,
  available: z.boolean(),
});
export type SandboxBackendInfo = z.infer<typeof sandboxBackendInfoSchema>;
