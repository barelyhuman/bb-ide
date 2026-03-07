import type { WebSocketConnectionState } from "./ws"

export type DaemonStatusIndicatorState =
  | "up-to-date"
  | "reconnecting"
  | "out-of-date"

interface ResolveDaemonStatusIndicatorStateArgs {
  connectionState: WebSocketConnectionState
  isRestartPending: boolean
  shouldRestart: boolean
}

export function resolveDaemonStatusIndicatorState({
  connectionState,
  isRestartPending,
  shouldRestart,
}: ResolveDaemonStatusIndicatorStateArgs): DaemonStatusIndicatorState {
  if (isRestartPending || connectionState !== "connected") {
    return "reconnecting"
  }

  return shouldRestart ? "out-of-date" : "up-to-date"
}
