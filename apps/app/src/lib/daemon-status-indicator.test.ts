import { describe, expect, it } from "vitest"
import { resolveDaemonStatusIndicatorState } from "./daemon-status-indicator"

describe("resolveDaemonStatusIndicatorState", () => {
  it("returns up-to-date when connected and current", () => {
    expect(
      resolveDaemonStatusIndicatorState({
        connectionState: "connected",
        isRestartPending: false,
        shouldRestart: false,
      }),
    ).toBe("up-to-date")
  })

  it("returns out-of-date when connected but restart is recommended", () => {
    expect(
      resolveDaemonStatusIndicatorState({
        connectionState: "connected",
        isRestartPending: false,
        shouldRestart: true,
      }),
    ).toBe("out-of-date")
  })

  it("returns reconnecting while waiting on a restart request", () => {
    expect(
      resolveDaemonStatusIndicatorState({
        connectionState: "connected",
        isRestartPending: true,
        shouldRestart: false,
      }),
    ).toBe("reconnecting")
  })

  it("returns reconnecting while the websocket is not connected", () => {
    expect(
      resolveDaemonStatusIndicatorState({
        connectionState: "reconnecting",
        isRestartPending: false,
        shouldRestart: true,
      }),
    ).toBe("reconnecting")
  })
})
