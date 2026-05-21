import type { FeatureFlags } from "@bb/domain";
import {
  readEnvVarWithDefault,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  BB_FF_ASK_USER_QUESTION_ENV,
  BB_FF_TERMINALS_ENV,
  DEFAULT_BB_FF_ASK_USER_QUESTION,
  DEFAULT_BB_FF_TERMINALS,
} from "./env-vars.js";

export type LoadFeatureFlagsArgs = EnvLoaderArgs;

export function loadFeatureFlags(
  args: LoadFeatureFlagsArgs = {},
): FeatureFlags {
  const loader = resolveEnvLoader(args);
  return {
    askUserQuestion: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_FF_ASK_USER_QUESTION,
      definition: BB_FF_ASK_USER_QUESTION_ENV,
      env: loader.env,
    }),
    terminals: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_BB_FF_TERMINALS,
      definition: BB_FF_TERMINALS_ENV,
      env: loader.env,
    }),
  };
}
