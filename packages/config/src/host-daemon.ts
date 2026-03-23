import { envsafe, url } from "envsafe";
import { commonConfig, readCommonConfig, type CommonConfig } from "./common.js";

export interface HostDaemonConfig extends CommonConfig {
  serverUrl: string;
}

export function readHostDaemonConfig(
  env: NodeJS.ProcessEnv = process.env,
): HostDaemonConfig {
  const common = readCommonConfig(env);
  const parsed = envsafe(
    {
      BB_SERVER_URL: url({ default: "http://localhost:3334" }),
    },
    { env },
  );

  return {
    ...common,
    serverUrl: parsed.BB_SERVER_URL,
  };
}

export const hostDaemonConfig = readHostDaemonConfig();

export { commonConfig };
