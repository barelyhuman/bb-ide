import { z } from "zod";

export const statusDataKeySchema = z.string().regex(/^[A-Za-z0-9_-]{1,80}$/u);
export type StatusDataKey = z.infer<typeof statusDataKeySchema>;
