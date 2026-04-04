import { hostTypeSchema } from "@bb/domain";
import type { HostType } from "@bb/domain";

export interface HostDaemonEntrypointOptions {
  bridgeBundleDir?: string;
  hostType?: HostType;
}

export interface ResolveHostDaemonEntrypointOptionsFromEnvArgs {
  env: NodeJS.ProcessEnv;
}

function toOptionalEnvString(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();
  return trimmedValue ? trimmedValue : undefined;
}

function parseHostType(value: string | undefined): HostType | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = hostTypeSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid BB_HOST_TYPE "${value}"`);
  }

  return parsed.data;
}

export function resolveHostDaemonEntrypointOptionsFromEnv(
  args: ResolveHostDaemonEntrypointOptionsFromEnvArgs,
): HostDaemonEntrypointOptions {
  return {
    bridgeBundleDir: toOptionalEnvString(args.env.BB_BRIDGE_DIR),
    hostType: parseHostType(toOptionalEnvString(args.env.BB_HOST_TYPE)),
  };
}
