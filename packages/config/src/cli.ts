import { resolveEnvLoader, type EnvLoaderArgs } from "./env.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { loadServerUrlValue } from "./server-url.js";

export interface CliConfig {
  BB_HOST_DAEMON_PORT: number;
  BB_SERVER_URL: string;
}

export interface LoadCliConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

export function loadCliConfig(args: LoadCliConfigArgs = {}): CliConfig {
  const loader = resolveEnvLoader(args);
  const serverUrl = loadServerUrlValue({
    ...args,
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
  });

  return {
    BB_HOST_DAEMON_PORT: loadHostDaemonPortValue({
      ...args,
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
    BB_SERVER_URL: serverUrl,
  };
}
