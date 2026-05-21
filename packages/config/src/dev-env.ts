import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  BB_DEV_APP_HOST_ENV,
  BB_DEV_APP_PORT_ENV,
  BB_DEV_ENV_PORT_ENV,
  DEFAULT_BB_DEV_APP_HOST,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

export interface DevEnvConfig {
  BB_DEV_APP_HOST: string;
  BB_DEV_APP_PORT?: number;
  BB_DEV_ENV_PORT?: number;
}

export type LoadDevEnvConfigArgs = EnvLoaderArgs;

export function loadDevEnvConfig(
  args: LoadDevEnvConfigArgs = {},
): DevEnvConfig {
  const loader = resolveEnvLoader(args);
  const config: DevEnvConfig = {
    BB_DEV_APP_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_DEV_APP_HOST,
      definition: BB_DEV_APP_HOST_ENV,
      env: loader.env,
    }),
  };
  const appPort = readOptionalEnvVar({
    context: loader.context,
    definition: BB_DEV_APP_PORT_ENV,
    env: loader.env,
  });
  const devEnvPort = readOptionalEnvVar({
    context: loader.context,
    definition: BB_DEV_ENV_PORT_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "BB_DEV_APP_PORT",
    target: config,
    value: appPort,
  });
  assignIfDefined({
    key: "BB_DEV_ENV_PORT",
    target: config,
    value: devEnvPort,
  });

  return config;
}
