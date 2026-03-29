import type { SandboxHost } from "@bb/sandbox-host";

export type SandboxHostLoader = () => Promise<SandboxHost>;

export interface SandboxHostRegistry {
  get(hostId: string): SandboxHost | undefined;
  getOrCreate(
    hostId: string,
    loadHost: SandboxHostLoader,
  ): Promise<SandboxHost>;
  remove(hostId: string): void;
  set(hostId: string, host: SandboxHost): void;
}

export function createSandboxHostRegistry(): SandboxHostRegistry {
  const hosts = new Map<string, SandboxHost>();
  const pendingHosts = new Map<string, Promise<SandboxHost>>();

  return {
    get(hostId: string): SandboxHost | undefined {
      return hosts.get(hostId);
    },
    getOrCreate(
      hostId: string,
      loadHost: SandboxHostLoader,
    ): Promise<SandboxHost> {
      const cached = hosts.get(hostId);
      if (cached) {
        return Promise.resolve(cached);
      }

      const pending = pendingHosts.get(hostId);
      if (pending) {
        return pending;
      }

      const loadingHost = loadHost()
        .then((host) => {
          if (pendingHosts.get(hostId) === loadingHost) {
            hosts.set(hostId, host);
          }
          return hosts.get(hostId) ?? host;
        })
        .finally(() => {
          if (pendingHosts.get(hostId) === loadingHost) {
            pendingHosts.delete(hostId);
          }
        });
      pendingHosts.set(hostId, loadingHost);
      return loadingHost;
    },
    remove(hostId: string): void {
      pendingHosts.delete(hostId);
      hosts.delete(hostId);
    },
    set(hostId: string, host: SandboxHost): void {
      pendingHosts.delete(hostId);
      hosts.set(hostId, host);
    },
  };
}
