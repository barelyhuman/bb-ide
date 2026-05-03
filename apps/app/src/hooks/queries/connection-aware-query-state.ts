import { useMemo } from "react";
import type { WebSocketConnectionState } from "@/lib/ws";
import { useServerConnectionState } from "../useServerConnectionState";

export type ConnectionAwareQueryStatus = "loading" | "ready" | "unavailable";

export interface ConnectionAwareQuerySnapshot {
  hasResolvedData: boolean;
  isFetching: boolean;
  isLoadingError: boolean;
}

export interface ConnectionAwareQueryStateArgs
  extends ConnectionAwareQuerySnapshot {
  serverConnectionState: WebSocketConnectionState;
}

export interface UseConnectionAwareQueryStateArgs
  extends ConnectionAwareQuerySnapshot {}

export interface ConnectionAwareQueryState {
  status: ConnectionAwareQueryStatus;
}

export function getConnectionAwareQueryState({
  hasResolvedData,
  isFetching,
  isLoadingError,
  serverConnectionState,
}: ConnectionAwareQueryStateArgs): ConnectionAwareQueryState {
  if (!hasResolvedData && isFetching) {
    return { status: "loading" };
  }

  if (
    !hasResolvedData &&
    isLoadingError &&
    serverConnectionState !== "connected"
  ) {
    return { status: "loading" };
  }

  if (!hasResolvedData && isLoadingError) {
    return { status: "unavailable" };
  }

  return { status: "ready" };
}

export function useConnectionAwareQueryState({
  hasResolvedData,
  isFetching,
  isLoadingError,
}: UseConnectionAwareQueryStateArgs): ConnectionAwareQueryState {
  const serverConnectionState = useServerConnectionState();

  return useMemo(
    () =>
      getConnectionAwareQueryState({
        hasResolvedData,
        isFetching,
        isLoadingError,
        serverConnectionState,
      }),
    [hasResolvedData, isFetching, isLoadingError, serverConnectionState],
  );
}
