import { hostDaemonConfig } from "@bb/config/host-daemon";

export type HostDaemonLocalApiMode = "full" | "health-only";

export interface HostDaemonLocalApiConfig {
  bindHost: string;
  healthPath: string;
  healthValue: string;
  mode: HostDaemonLocalApiMode;
  port: number;
}

export interface HostDaemonLocalApiOverrides {
  bindHost?: string;
  healthPath?: string;
  healthValue?: string;
  mode?: HostDaemonLocalApiMode;
  port?: number;
}

export interface ResolveHostDaemonLocalApiConfigArgs {
  localApi: HostDaemonLocalApiOverrides | undefined;
}

export function resolveHostDaemonLocalApiConfig(
  args: ResolveHostDaemonLocalApiConfigArgs,
): HostDaemonLocalApiConfig {
  return {
    bindHost: args.localApi?.bindHost ?? "localhost",
    healthPath: args.localApi?.healthPath ?? "/health",
    healthValue: args.localApi?.healthValue ?? "ok",
    mode: args.localApi?.mode ?? "full",
    port: args.localApi?.port ?? hostDaemonConfig.BB_HOST_DAEMON_PORT,
  };
}
