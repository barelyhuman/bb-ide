import type { Environment, Host } from "@bb/domain";
import {
  type EnvironmentDisplayInfo,
  formatEnvironmentDisplay,
} from "@bb/core-ui";
import { type Client, unwrap } from "../client.js";
import { fetchLocalHostId } from "../daemon.js";

export interface ThreadEnvironmentInfo {
  display: EnvironmentDisplayInfo;
  hostId: string;
  hostName: string | null;
  isLocalHost: boolean;
}

async function fetchHost(args: {
  client: Client;
  hostId: string;
}): Promise<Host | null> {
  try {
    return await unwrap<Host>(
      args.client.api.v1.hosts[":id"].$get({
        param: { id: args.hostId },
      }),
    );
  } catch {
    return null;
  }
}

export async function fetchEnvironmentInfo(args: {
  client: Client;
  environmentId: string;
}): Promise<ThreadEnvironmentInfo | null> {
  try {
    const [env, localHostId] = await Promise.all([
      unwrap<Environment>(
        args.client.api.v1.environments[":id"].$get({
          param: { id: args.environmentId },
        }),
      ),
      fetchLocalHostId(),
    ]);
    const host = await fetchHost({
      client: args.client,
      hostId: env.hostId,
    });
    const isLocal = env.hostId === localHostId;
    return {
      display: formatEnvironmentDisplay({
        environment: env,
        isLocalHost: isLocal,
        hostName: host?.name,
        hostType: host?.type,
        hostProvider: host?.provider,
      }),
      hostId: env.hostId,
      hostName: host?.name ?? null,
      isLocalHost: isLocal,
    };
  } catch {
    return null;
  }
}

export function printEnvironmentInfo(env: ThreadEnvironmentInfo): void {
  const hostLabel = env.hostName ?? env.hostId;
  const hostSuffix = env.isLocalHost ? " (localhost)" : "";
  console.log(`  Host: ${hostLabel}${hostSuffix} (${env.hostId})`);
  console.log(`  Environment: ${env.display.modeLabel} (${env.display.id})`);
}
