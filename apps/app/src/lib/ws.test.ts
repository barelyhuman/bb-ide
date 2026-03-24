import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { parseSubKey, WebSocketManager } from "./ws"

class FakeWebSocket {
  static instances: FakeWebSocket[] = []

  readonly url: string
  readonly sent: string[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null

  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(message: string) {
    this.sent.push(message)
  }

  close() {
    this.readyState = 3
    this.onclose?.()
  }
}

describe("parseSubKey", () => {
  it("parses entity-only subscription keys", () => {
    expect(parseSubKey("thread")).toEqual({ entity: "thread" })
    expect(parseSubKey("system")).toEqual({ entity: "system" })
  })

  it("parses entity + id subscription keys", () => {
    expect(parseSubKey("thread:t-1")).toEqual({ entity: "thread", id: "t-1" })
  })

  it("parses all entity types", () => {
    expect(parseSubKey("project:p-1")).toEqual({ entity: "project", id: "p-1" })
    expect(parseSubKey("environment:e-1")).toEqual({ entity: "environment", id: "e-1" })
  })

  it("rejects unknown entities", () => {
    expect(parseSubKey("unknown")).toBeNull()
    expect(parseSubKey("bogus:id-1")).toBeNull()
  })
})

describe("WebSocketManager", () => {
  const originalWindow = globalThis.window
  const originalWebSocket = globalThis.WebSocket

  beforeEach(() => {
    vi.useFakeTimers()
    FakeWebSocket.instances.length = 0
    Object.defineProperty(globalThis, "window", {
      value: {
        location: {
          protocol: "http:",
          host: "localhost:5173",
        },
      },
      configurable: true,
    })
    Object.defineProperty(globalThis, "WebSocket", {
      value: FakeWebSocket,
      configurable: true,
    })
  })

  afterEach(() => {
    vi.useRealTimers()
    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
    })
    Object.defineProperty(globalThis, "WebSocket", {
      value: originalWebSocket,
      configurable: true,
    })
  })

  it("does not schedule reconnects after an intentional disconnect", () => {
    const manager = new WebSocketManager()

    manager.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)

    manager.disconnect()
    vi.advanceTimersByTime(3000)

    expect(FakeWebSocket.instances).toHaveLength(1)
  })

  it("reconnects after an unexpected close", () => {
    const manager = new WebSocketManager()

    manager.connect()
    expect(FakeWebSocket.instances).toHaveLength(1)

    FakeWebSocket.instances[0]?.onclose?.()
    vi.advanceTimersByTime(3000)

    expect(FakeWebSocket.instances).toHaveLength(2)
  })
})
