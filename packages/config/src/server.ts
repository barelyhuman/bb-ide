import path from "node:path";
import { envsafe, port, str } from "envsafe";
import { commonConfig, readCommonConfig, type CommonConfig } from "./common.js";

export interface ServerConfig extends CommonConfig {
  port: number;
  databaseUrl: string;
  e2bApiKey?: string;
}

export function readServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const common = readCommonConfig(env);
  const parsed = envsafe(
    {
      BB_SERVER_PORT: port({ default: 3334 }),
      BB_DATABASE_URL: str({
        default: path.join(common.dataDir, "server.sqlite"),
      }),
      BB_E2B_API_KEY: str({ allowEmpty: true, default: "" }),
    },
    { env },
  );

  return {
    ...common,
    port: parsed.BB_SERVER_PORT,
    databaseUrl: parsed.BB_DATABASE_URL,
    e2bApiKey: parsed.BB_E2B_API_KEY || undefined,
  };
}

export const serverConfig = readServerConfig();

export { commonConfig };
