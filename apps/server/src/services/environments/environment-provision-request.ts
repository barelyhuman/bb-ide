import { z } from "zod";
import { environmentProvisionCommandSchema } from "@bb/host-daemon-contract";
import type { EnvironmentProvisionCommand } from "@bb/host-daemon-contract";

const environmentProvisionRequestBaseSchema = z.object({
  provisioningId: z.string().min(1),
});

export const directEnvironmentProvisionRequestSchema =
  environmentProvisionRequestBaseSchema.extend({
    mode: z.literal("direct"),
    command: environmentProvisionCommandSchema,
  });
export type DirectEnvironmentProvisionRequest = z.infer<
  typeof directEnvironmentProvisionRequestSchema
>;

export const sandboxHostEnvironmentProvisionRequestSchema =
  environmentProvisionRequestBaseSchema.extend({
    mode: z.literal("sandbox-host"),
    sandboxType: z.string(),
    command: environmentProvisionCommandSchema,
  });
export type SandboxHostEnvironmentProvisionRequest = z.infer<
  typeof sandboxHostEnvironmentProvisionRequestSchema
>;

export const environmentProvisionRequestSchema = z.discriminatedUnion("mode", [
  directEnvironmentProvisionRequestSchema,
  sandboxHostEnvironmentProvisionRequestSchema,
]);

export type EnvironmentProvisionRequest =
  | DirectEnvironmentProvisionRequest
  | SandboxHostEnvironmentProvisionRequest;

export interface BuildDirectEnvironmentProvisionRequestArgs {
  command: EnvironmentProvisionCommand;
  provisioningId: string;
}

export interface BuildSandboxHostEnvironmentProvisionRequestArgs {
  command: EnvironmentProvisionCommand;
  provisioningId: string;
  sandboxType: string;
}

export function buildDirectEnvironmentProvisionRequest(
  args: BuildDirectEnvironmentProvisionRequestArgs,
): DirectEnvironmentProvisionRequest {
  return {
    mode: "direct",
    command: args.command,
    provisioningId: args.provisioningId,
  };
}

export function buildSandboxHostEnvironmentProvisionRequest(
  args: BuildSandboxHostEnvironmentProvisionRequestArgs,
): SandboxHostEnvironmentProvisionRequest {
  return {
    mode: "sandbox-host",
    command: args.command,
    provisioningId: args.provisioningId,
    sandboxType: args.sandboxType,
  };
}
