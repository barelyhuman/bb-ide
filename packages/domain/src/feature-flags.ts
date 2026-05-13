import { z } from "zod";

export const featureFlagsSchema = z.object({
  askUserQuestion: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  askUserQuestion: false,
};
