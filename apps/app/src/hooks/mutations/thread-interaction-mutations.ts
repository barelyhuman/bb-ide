import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PendingInteraction } from "@bb/domain";
import type { ResolvePendingInteractionRequest } from "@bb/server-contract";
import * as api from "@/lib/api";
import { invalidateThreadPendingInteractionResolutionQueries } from "../cache-owners/mutation-cache-effects";

export interface ResolveThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

export function useResolveThreadPendingInteraction() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to resolve pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({
      threadId,
      interactionId,
      resolution,
    }: ResolveThreadPendingInteractionMutationRequest): Promise<PendingInteraction> =>
      api.resolveThreadPendingInteraction(threadId, interactionId, resolution),
    onSuccess: (interaction, variables) => {
      invalidateThreadPendingInteractionResolutionQueries({
        queryClient,
        threadId: variables.threadId,
      });
      return interaction;
    },
  });
}
