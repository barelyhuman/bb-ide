import { z } from "zod";
import { parseJsonWithSchema } from "../lib/json-parsing.js";

const threadProvisioningIdentityPayloadSchema = z.object({
  provisioningId: z.string().min(1),
});

export function readThreadProvisioningIdFromPayload(payload: string): string {
  return parseJsonWithSchema(
    payload,
    threadProvisioningIdentityPayloadSchema,
  ).provisioningId;
}
