import { z } from "zod";

export const projectSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  projectInstructions: z.string().optional(),
  defaultProviderId: z.string().optional(),
  primaryCheckoutThreadId: z.string().optional(),
  rootPathExists: z.boolean().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Project = z.infer<typeof projectSchema>;
