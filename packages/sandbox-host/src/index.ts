export interface SandboxHost {
  /** The host ID assigned to the provisioned sandbox */
  hostId: string;

  /** Suspend the sandbox (pause to save cost) */
  suspend(): Promise<void>;

  /** Resume a suspended sandbox */
  resume(): Promise<void>;

  /** Destroy the sandbox and clean up all resources */
  destroy(): Promise<void>;
}

export interface ProvisionHostOptions {
  sandboxType: string;
  serverUrl: string;
  authToken: string;
}

/**
 * Provision an ephemeral sandbox host.
 * Stub implementation — throws "Not implemented" until Phase 8.
 */
export async function provisionHost(
  _options: ProvisionHostOptions,
): Promise<SandboxHost> {
  throw new Error("Not implemented");
}
