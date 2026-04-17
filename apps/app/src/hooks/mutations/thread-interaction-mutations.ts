import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PendingInteraction } from "@bb/domain";
import type { ResolvePendingInteractionRequest } from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  statusQueryKey,
  threadPendingInteractionsQueryKey,
  threadQueryKey,
  threadTimelineQueryKeyPrefix,
  threadsQueryKey,
} from "../queries/query-keys";

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
      queryClient.invalidateQueries({
        queryKey: threadPendingInteractionsQueryKey(variables.threadId),
      });
      queryClient.invalidateQueries({
        queryKey: threadTimelineQueryKeyPrefix(variables.threadId),
      });
      queryClient.invalidateQueries({
        queryKey: threadQueryKey(variables.threadId),
      });
      queryClient.invalidateQueries({
        queryKey: threadsQueryKey(),
      });
      queryClient.invalidateQueries({
        queryKey: statusQueryKey(),
      });
      return interaction;
    },
  });
}
