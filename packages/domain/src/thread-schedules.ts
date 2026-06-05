import { z } from "zod";

// Intentionally single-valued today; persisted as the discriminator for future
// non-cron schedule kinds.
export const threadScheduleKindValues = ["cron"] as const;
export const threadScheduleKindSchema = z.enum(threadScheduleKindValues);
export type ThreadScheduleKind = z.infer<typeof threadScheduleKindSchema>;
