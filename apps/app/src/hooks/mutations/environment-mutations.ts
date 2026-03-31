import { useMutation } from "@tanstack/react-query";
import type { Environment } from "@bb/domain";
import type {
  EnvironmentActionRequest,
  EnvironmentActionResponse,
  UpdateEnvironmentRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  getEnvironmentActionInvalidationQueryKeys,
  getEnvironmentStateInvalidationQueryKeys,
  environmentQueryKey,
  useApiClient,
} from "../queries/shared";

type RequestEnvironmentActionMutationRequest = { id: string } & EnvironmentActionRequest;
type UpdateEnvironmentMutationRequest = { id: string } & UpdateEnvironmentRequest;

export function useRequestEnvironmentAction() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({
      id,
      ...request
    }: RequestEnvironmentActionMutationRequest): Promise<EnvironmentActionResponse> =>
      api.requestEnvironmentAction(id, request),
    onSuccess: (_response, variables) => {
      for (const queryKey of getEnvironmentActionInvalidationQueryKeys({
        environmentId: variables.id,
      })) {
        queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}

export function useUpdateEnvironment() {
  const queryClient = useApiClient();

  return useMutation({
    mutationFn: ({ id, ...request }: UpdateEnvironmentMutationRequest) =>
      api.updateEnvironment(id, request),
    onSuccess: (environment: Environment) => {
      queryClient.setQueryData<Environment>(
        environmentQueryKey(environment.id),
        environment,
      );
      for (const queryKey of getEnvironmentStateInvalidationQueryKeys({
        environmentId: environment.id,
      })) {
        if (queryKey[0] === "environment") {
          continue;
        }
        queryClient.invalidateQueries({ queryKey });
      }
      queryClient.invalidateQueries({ queryKey: ["status"] });
    },
  });
}
