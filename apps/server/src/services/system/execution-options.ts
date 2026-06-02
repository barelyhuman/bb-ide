import type {
  SystemExecutionOptionsModelLoadErrorCode,
  SystemExecutionOptionsModelLoadError,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import type { FeatureFlags, ProviderInfo } from "@bb/domain";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { ApiError } from "../../errors.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";

export interface SystemExecutionOptionsRequest {
  environmentId?: string;
  hostId?: string;
  providerId?: string;
}

interface ApplyProviderFeatureFlagsArgs {
  featureFlags: FeatureFlags;
  providers: ProviderInfo[];
}

interface BuildModelLoadErrorArgs {
  error: ApiError;
  provider: ProviderInfo;
}

type ModelListResult = Pick<
  SystemExecutionOptionsResponse,
  "modelLoadError" | "models" | "selectedOnlyModels"
>;

export function applyProviderFeatureFlags({
  featureFlags,
  providers,
}: ApplyProviderFeatureFlagsArgs): ProviderInfo[] {
  if (featureFlags.askUserQuestion) {
    return providers;
  }

  return providers.map((provider) => {
    if (!provider.capabilities.supportsUserQuestion) {
      return provider;
    }

    return {
      ...provider,
      capabilities: {
        ...provider.capabilities,
        supportsUserQuestion: false,
      },
    };
  });
}

export async function resolveSystemExecutionOptions(
  deps: AppDeps,
  query: SystemExecutionOptionsRequest,
): Promise<SystemExecutionOptionsResponse> {
  const hostId = resolveSystemLookupHostId(deps, query);
  const { providers } = await callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "provider.list" },
  });
  const featureFlaggedProviders = applyProviderFeatureFlags({
    featureFlags: deps.config.featureFlags,
    providers,
  });
  const requestedProvider = query.providerId
    ? providers.find((provider) => provider.id === query.providerId)
    : undefined;
  const modelsProvider = requestedProvider ?? providers[0];

  if (!modelsProvider) {
    return {
      providers: featureFlaggedProviders,
      models: [],
      selectedOnlyModels: [],
      modelLoadError: null,
    };
  }

  let modelResult: ModelListResult;
  try {
    const { models, selectedOnlyModels } = await callHostRetryableOnlineRpc(deps, {
      hostId,
      timeoutMs: COMMAND_TIMEOUT_MS,
      command: {
        type: "provider.list_models",
        providerId: modelsProvider.id,
      },
    });
    modelResult = {
      models,
      selectedOnlyModels,
      modelLoadError: null,
    };
  } catch (error) {
    if (
      !(error instanceof ApiError) ||
      (error.status !== 502 && error.status !== 504)
    ) {
      throw error;
    }
    deps.logger.warn(
      {
        err: error,
        hostId,
        providerId: modelsProvider.id,
      },
      "Failed to resolve provider models",
    );
    modelResult = {
      models: [],
      selectedOnlyModels: [],
      modelLoadError: buildModelLoadError({
        error,
        provider: modelsProvider,
      }),
    };
  }

  return {
    providers: featureFlaggedProviders,
    models: modelResult.models,
    selectedOnlyModels: modelResult.selectedOnlyModels,
    modelLoadError: modelResult.modelLoadError,
  };
}

function buildModelLoadError({
  error,
  provider,
}: BuildModelLoadErrorArgs): SystemExecutionOptionsModelLoadError {
  return {
    providerId: provider.id,
    code: toModelLoadErrorCode(error),
  };
}

function toModelLoadErrorCode(
  error: ApiError,
): SystemExecutionOptionsModelLoadErrorCode {
  if (error.body.code === "command_timeout") {
    return "timeout";
  }

  if (error.body.code === "missing_executable") {
    return "missing_executable";
  }

  return "failed";
}
