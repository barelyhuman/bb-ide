import { envsafe, url } from "envsafe";
import { commonConfig, readCommonConfig, type CommonConfig } from "./common.js";

export interface CliConfig extends CommonConfig {
  serverUrl: string;
}

export function readCliConfig(env: NodeJS.ProcessEnv = process.env): CliConfig {
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

export const cliConfig = readCliConfig();

export { commonConfig };
