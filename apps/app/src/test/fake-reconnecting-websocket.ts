interface FakeReconnectingWebSocketRegistry {
  instances: FakeReconnectingWebSocket[]
}

declare global {
  var __bbFakeReconnectingWebSocketRegistry: FakeReconnectingWebSocketRegistry | undefined
}

function getRegistry(): FakeReconnectingWebSocketRegistry {
  if (!globalThis.__bbFakeReconnectingWebSocketRegistry) {
    globalThis.__bbFakeReconnectingWebSocketRegistry = {
      instances: [],
    }
  }

  return globalThis.__bbFakeReconnectingWebSocketRegistry
}

export function resetFakeReconnectingWebSockets(): void {
  getRegistry().instances.length = 0
}

export class FakeReconnectingWebSocket {
  static readonly CLOSED = 3
  static readonly CONNECTING = 0
  static readonly OPEN = 1

  static latest(): FakeReconnectingWebSocket {
    const latestSocket = getRegistry().instances.at(-1)
    if (!latestSocket) {
      throw new Error("Expected a fake websocket instance")
    }
    return latestSocket
  }

  static reset(): void {
    resetFakeReconnectingWebSockets()
  }

  onclose: ((event: Event) => void) | null = null
  onmessage: ((event: MessageEvent) => void) | null = null
  onopen: ((event: Event) => void) | null = null
  readyState = FakeReconnectingWebSocket.CONNECTING
  readonly sentMessages: string[] = []

  constructor(readonly url: string) {
    getRegistry().instances.push(this)
  }

  close(): void {
    this.readyState = FakeReconnectingWebSocket.CLOSED
    this.onclose?.(new Event("close"))
  }

  emitJson(message: unknown): void {
    this.onmessage?.(new MessageEvent("message", {
      data: JSON.stringify(message),
    }))
  }

  open(): void {
    this.readyState = FakeReconnectingWebSocket.OPEN
    this.onopen?.(new Event("open"))
  }

  send(message: string): void {
    this.sentMessages.push(message)
  }
}
