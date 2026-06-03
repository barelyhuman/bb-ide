import { z } from "zod";

/**
 * Feature flags resolved by the server and exposed to clients.
 *
 * `placeholder` is a PERMANENT, non-functional keep-alive: it lets the flag
 * system keep functioning with zero real flags. Without it the schema and type
 * would collapse to empty, so adding the next flag would mean re-deriving this
 * whole seam instead of appending one field. Add real flags alongside it; do
 * NOT remove it, and do NOT gate behavior on it.
 */
export const featureFlagsSchema = z.object({
  placeholder: z.boolean(),
});
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;

export const defaultFeatureFlags: FeatureFlags = {
  placeholder: false,
};
