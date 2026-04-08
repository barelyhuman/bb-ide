import path from "node:path";
import { ApiError } from "../../errors.js";
import type { SandboxWorkSessionDeps } from "../../types.js";
import { ensureHostSessionReadyForWork } from "../hosts/host-lifecycle.js";

export interface RequireThreadStoragePathArgs {
  hostId: string;
  threadId: string;
}

export async function requireThreadStoragePath(
  deps: SandboxWorkSessionDeps,
  args: RequireThreadStoragePathArgs,
): Promise<string> {
  const session = await ensureHostSessionReadyForWork(deps, {
    hostId: args.hostId,
  });
  if (!session.dataDir) {
    throw new ApiError(
      502,
      "host_protocol_mismatch",
      "Connected host session did not report its data directory",
    );
  }
  return path.join(session.dataDir, "thread-storage", args.threadId);
}
