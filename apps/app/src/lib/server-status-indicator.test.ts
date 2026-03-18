import { describe, expect, it } from "vitest"
import { resolveServerStatusIndicatorState } from "./server-status-indicator"

describe("resolveServerStatusIndicatorState", () => {
  it("returns up-to-date when connected and current", () => {
    expect(
      resolveServerStatusIndicatorState({
        connectionState: "connected",
        isRestartPending: false,
        shouldRestart: false,
      }),
    ).toBe("up-to-date")
  })

  it("returns out-of-date when connected but restart is recommended", () => {
    expect(
      resolveServerStatusIndicatorState({
        connectionState: "connected",
        isRestartPending: false,
        shouldRestart: true,
      }),
    ).toBe("out-of-date")
  })

  it("returns reconnecting while waiting on a restart request", () => {
    expect(
      resolveServerStatusIndicatorState({
        connectionState: "connected",
        isRestartPending: true,
        shouldRestart: false,
      }),
    ).toBe("reconnecting")
  })

  it("returns reconnecting while the websocket is not connected", () => {
    expect(
      resolveServerStatusIndicatorState({
        connectionState: "reconnecting",
        isRestartPending: false,
        shouldRestart: true,
      }),
    ).toBe("reconnecting")
  })
})
