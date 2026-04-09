// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest"
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils"

async function importFreshApiHostDaemon(): Promise<typeof import("./api-host-daemon")> {
  vi.resetModules()
  return import("./api-host-daemon")
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("api-host-daemon", () => {
  it("reuses the daemon client for the same port and recreates it when the port changes", async () => {
    const { getHostDaemonClient } = await importFreshApiHostDaemon()

    const firstClient = getHostDaemonClient(3002)
    const secondClient = getHostDaemonClient(3002)
    const thirdClient = getHostDaemonClient(4000)

    expect(secondClient).toBe(firstClient)
    expect(thirdClient).not.toBe(firstClient)
  })

  it("returns the daemon status when the daemon is reachable", async () => {
    installFetchRoutes([
      {
        pathname: "/status",
        port: 3002,
        handler: async () => jsonResponse({
          connected: true,
          hostId: "host_1",
          serverUrl: "http://localhost:3334",
          supportsNativeFolderPicker: true,
        }),
      },
    ])

    const { fetchHostStatus } = await importFreshApiHostDaemon()

    await expect(fetchHostStatus(3002)).resolves.toEqual({
      connected: true,
      hostId: "host_1",
      serverUrl: "http://localhost:3334",
      supportsNativeFolderPicker: true,
    })
  })

  it("returns null when daemon is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("ECONNREFUSED")
    }))

    const { fetchHostStatus } = await importFreshApiHostDaemon()

    await expect(fetchHostStatus(3002)).resolves.toBeNull()
  })

  it("returns null when status response is not ok", async () => {
    installFetchRoutes([
      {
        pathname: "/status",
        port: 3002,
        handler: async () => new Response(null, { status: 503 }),
      },
    ])

    const { fetchHostStatus } = await importFreshApiHostDaemon()

    await expect(fetchHostStatus(3002)).resolves.toBeNull()
  })

  it("returns hostId only when the daemon reports a connected host", async () => {
    installFetchRoutes([
      {
        pathname: "/status",
        port: 3002,
        handler: async () => jsonResponse({
          connected: false,
          hostId: "host_1",
          serverUrl: "http://localhost:3334",
          supportsNativeFolderPicker: false,
        }),
      },
    ])

    const { fetchHostId } = await importFreshApiHostDaemon()

    await expect(fetchHostId(3002)).resolves.toBeNull()
  })
})
