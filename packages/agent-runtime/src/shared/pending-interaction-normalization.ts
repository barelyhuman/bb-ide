import { z } from "zod";
import {
  pendingInteractionQuestionOptionSchema,
  pendingInteractionRequestedPermissionProfileSchema,
  type PendingInteractionQuestionOption,
  type PendingInteractionRequestedPermissionProfile,
} from "@bb/domain";

const pendingInteractionPermissionNetworkInputSchema = z.object({
  enabled: z.boolean().nullable().optional(),
}).transform((value) => ({
  enabled: value.enabled ?? null,
}));

const pendingInteractionPermissionFileSystemInputSchema = z.object({
  read: z.array(z.string()).nullable().optional(),
  write: z.array(z.string()).nullable().optional(),
}).transform((value) => ({
  read: value.read ?? [],
  write: value.write ?? [],
}));

const pendingInteractionPermissionMacOsBundleIdsInputSchema = z.object({
  bundleIds: z.array(z.string()).nullable().optional(),
}).transform((value) => ({
  kind: "bundle_ids" as const,
  bundleIds: value.bundleIds ?? [],
}));

const pendingInteractionPermissionMacOsAutomationInputSchema = z.union([
  z.literal("none"),
  z.literal("all"),
  pendingInteractionPermissionMacOsBundleIdsInputSchema,
  z.null(),
  z.undefined(),
]).transform((value) => {
  if (value == null || value === "none" || value === "all") {
    return value ?? "none";
  }

  return value;
});

const pendingInteractionPermissionMacOsInputSchema = z.object({
  preferences: z.enum(["none", "read_only", "read_write"]).nullable().optional(),
  automations: pendingInteractionPermissionMacOsAutomationInputSchema.optional(),
  launchServices: z.boolean().nullable().optional(),
  accessibility: z.boolean().nullable().optional(),
  calendar: z.boolean().nullable().optional(),
  reminders: z.boolean().nullable().optional(),
  contacts: z.enum(["none", "read_only", "read_write"]).nullable().optional(),
}).transform((value) => ({
  preferences: value.preferences ?? "none",
  automations: value.automations ?? "none",
  launchServices: value.launchServices ?? false,
  accessibility: value.accessibility ?? false,
  calendar: value.calendar ?? false,
  reminders: value.reminders ?? false,
  contacts: value.contacts ?? "none",
}));

const pendingInteractionRequestedPermissionProfileInputSchema = z.object({
  network: pendingInteractionPermissionNetworkInputSchema.nullable().optional(),
  fileSystem: pendingInteractionPermissionFileSystemInputSchema.nullable().optional(),
  macos: pendingInteractionPermissionMacOsInputSchema.nullable().optional(),
}).transform((value) => ({
  network: value.network ?? null,
  fileSystem: value.fileSystem ?? null,
  macos: value.macos ?? null,
}));

type PendingInteractionRequestedPermissionProfileInput = z.input<
  typeof pendingInteractionRequestedPermissionProfileInputSchema
>;

const pendingInteractionQuestionOptionInputSchema = z.object({
  label: z.string(),
  description: z.string(),
  preview: z.string().nullable().optional(),
}).transform((value) => ({
  label: value.label,
  description: value.description,
  preview: value.preview ?? null,
}));

type PendingInteractionQuestionOptionInput = z.input<
  typeof pendingInteractionQuestionOptionInputSchema
>;

export function normalizePendingInteractionRequestedPermissionProfile(
  input: PendingInteractionRequestedPermissionProfileInput,
): PendingInteractionRequestedPermissionProfile {
  return pendingInteractionRequestedPermissionProfileSchema.parse(
    pendingInteractionRequestedPermissionProfileInputSchema.parse(input),
  );
}

export function normalizePendingInteractionQuestionOption(
  input: PendingInteractionQuestionOptionInput,
): PendingInteractionQuestionOption {
  return pendingInteractionQuestionOptionSchema.parse(
    pendingInteractionQuestionOptionInputSchema.parse(input),
  );
}

export function toOptionalPendingInteractionQuestionOptionPreview(
  preview: string | null,
): string | undefined {
  return preview ?? undefined;
}
