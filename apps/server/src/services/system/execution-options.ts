import type {
  SystemExecutionOptionsProviderScope,
  SystemExecutionOptionsResponse,
} from "@bb/server-contract";
import type { AppDeps } from "../../types.js";
import { COMMAND_TIMEOUT_MS } from "../../constants.js";
import { queueCommandAndWait } from "../hosts/command-wait.js";
import { resolveSystemLookupHostId } from "./host-lookup.js";

export interface SystemExecutionOptionsRequest {
  environmentId?: string;
  hostId?: string;
  providerId?: string;
  providerScope: SystemExecutionOptionsProviderScope;
  selectedModel?: string;
}

export async function resolveSystemExecutionOptions(
  deps: AppDeps,
  query: SystemExecutionOptionsRequest,
): Promise<SystemExecutionOptionsResponse> {
  const hostId = resolveSystemLookupHostId(deps, query);
  const { providers } = await queueCommandAndWait(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: { type: "provider.list" },
  });
  const requestedProvider = query.providerId
    ? providers.find((provider) => provider.id === query.providerId)
    : undefined;
  const modelsProviderId =
    requestedProvider?.id ??
    (query.providerScope === "all" ? providers[0]?.id : undefined);
  const scopedProviders =
    query.providerScope === "selected"
      ? requestedProvider
        ? [requestedProvider]
        : []
      : providers;

  if (!modelsProviderId) {
    return {
      providers: scopedProviders,
      models: [],
    };
  }

  const { models } = await queueCommandAndWait(deps, {
    hostId,
    timeoutMs: COMMAND_TIMEOUT_MS,
    command: {
      type: "provider.list_models",
      providerId: modelsProviderId,
      selectedModel: query.selectedModel,
    },
  });

  return {
    providers: scopedProviders,
    models,
  };
}
