import type { WebSocketConnectionState } from "./ws"

export type ServerStatusIndicatorState =
  | "up-to-date"
  | "reconnecting"
  | "out-of-date"

interface ResolveServerStatusIndicatorStateArgs {
  connectionState: WebSocketConnectionState
  isRestartPending: boolean
  shouldRestart: boolean
}

export function resolveServerStatusIndicatorState({
  connectionState,
  isRestartPending,
  shouldRestart,
}: ResolveServerStatusIndicatorStateArgs): ServerStatusIndicatorState {
  if (isRestartPending || connectionState !== "connected") {
    return "reconnecting"
  }

  return shouldRestart ? "out-of-date" : "up-to-date"
}
