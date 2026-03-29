import { Sandbox } from "e2b";
import type { Sandbox as E2BSandbox } from "e2b";
import type {
  ResumeSandboxOptions,
  SandboxHandle,
  SandboxHost,
} from "./types.js";

export function createSandboxHost(
  sandbox: E2BSandbox,
  hostId: string,
): SandboxHost {
  let currentSandbox = sandbox;

  return {
    hostId,
    externalId: sandbox.sandboxId,
    async suspend(): Promise<void> {
      await currentSandbox.pause();
    },
    async resume(): Promise<void> {
      currentSandbox = await currentSandbox.connect();
    },
    async destroy(): Promise<void> {
      await currentSandbox.kill();
    },
    async extendTimeout(timeoutMs: number): Promise<void> {
      await currentSandbox.setTimeout(timeoutMs);
    },
  };
}

export async function resumeSandbox(
  externalId: string,
  options: ResumeSandboxOptions = {},
): Promise<SandboxHandle> {
  return Sandbox.connect(externalId, options);
}
