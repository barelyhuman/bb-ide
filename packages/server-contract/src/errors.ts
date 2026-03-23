import { z } from "zod";

export const domainErrorCodeSchema = z.enum([
  "invalid_request",
  "thread_not_found",
  "project_not_found",
  "thread_archived",
  "inactive_session",
  "provider_unavailable",
  "provider_timeout",
  "provider_rpc_error",
  "unsupported_operation",
  "no_active_turn",
  "internal_error",
]);
export type DomainErrorCode = z.infer<typeof domainErrorCodeSchema>;

export const apiErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  retryable: z.boolean().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
