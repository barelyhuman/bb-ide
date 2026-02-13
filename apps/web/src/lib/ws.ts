import type {
  ClientMessage,
  RealtimeEntity,
  ServerMessage,
} from "@beanbag/core";

export type ChangeCallback = (entity: RealtimeEntity, id?: string) => void;

class WebSocketManager {
  private socket: WebSocket | null = null;
  private subscriptions = new Set<string>();
  private callbacks = new Set<ChangeCallback>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connected = false;

  connect(): void {
    if (this.socket) return;

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${protocol}//${window.location.host}/ws`;

    try {
      this.socket = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.socket.onopen = () => {
      this.connected = true;
      // Re-subscribe to all active subscriptions
      for (const key of this.subscriptions) {
        const [entity, id] = parseSubKey(key);
        this.sendMessage({ type: "subscribe", entity, id });
      }
    };

    this.socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data) as ServerMessage;
        if (msg.type === "changed") {
          for (const cb of this.callbacks) {
            cb(msg.entity, msg.id);
          }
        }
      } catch {
        // Ignore malformed messages
      }
    };

    this.socket.onclose = () => {
      this.connected = false;
      this.socket = null;
      this.scheduleReconnect();
    };

    this.socket.onerror = () => {
      // onclose will fire after this
    };
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
    this.connected = false;
  }

  subscribe(entity: RealtimeEntity, id?: string): void {
    const key = subKey(entity, id);
    this.subscriptions.add(key);
    if (this.connected) {
      this.sendMessage({ type: "subscribe", entity, id });
    }
  }

  unsubscribe(entity: RealtimeEntity, id?: string): void {
    const key = subKey(entity, id);
    this.subscriptions.delete(key);
    if (this.connected) {
      this.sendMessage({ type: "unsubscribe", entity, id });
    }
  }

  onChanged(callback: ChangeCallback): () => void {
    this.callbacks.add(callback);
    return () => {
      this.callbacks.delete(callback);
    };
  }

  private sendMessage(msg: ClientMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, 3000);
  }
}

function subKey(entity: RealtimeEntity, id?: string): string {
  return id ? `${entity}:${id}` : entity;
}

function parseSubKey(key: string): [RealtimeEntity, string | undefined] {
  const idx = key.indexOf(":");
  if (idx === -1) return [key as RealtimeEntity, undefined];
  return [key.slice(0, idx) as RealtimeEntity, key.slice(idx + 1)];
}

// Singleton instance
export const wsManager = new WebSocketManager();
