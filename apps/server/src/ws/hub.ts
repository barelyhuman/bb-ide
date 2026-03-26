import type { DbNotifier } from "@bb/db";
import type {
  ThreadChangeKind,
  ProjectChangeKind,
  EnvironmentChangeKind,
  SystemChangeKind,
  ServerMessage,
} from "@bb/server-contract";
import type { WSContext } from "hono/ws";

interface DaemonConnection {
  sessionId: string;
  hostId: string;
  ws: WSContext;
}

interface CommandResultWaiter {
  resolve: (result: CommandWaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface CommandWaitResult {
  ok: boolean;
  result?: unknown;
  errorCode?: string;
  errorMessage?: string;
}

export class NotificationHub implements DbNotifier {
  private clientSockets = new Map<WSContext, Set<string>>();
  private subscriptionClients = new Map<string, Set<WSContext>>();
  private daemonConnections = new Map<string, DaemonConnection>();
  private commandWaiters = new Map<string, CommandResultWaiter>();
  private commandNotifyCallbacks = new Map<string, Set<() => void>>();

  // --- DbNotifier implementation ---

  notifyThread(threadId: string, changes: ThreadChangeKind[]): void {
    this.broadcast(`thread:${threadId}`, {
      type: "changed",
      entity: "thread",
      id: threadId,
      changes,
    });
  }

  notifyProject(projectId: string, changes: ProjectChangeKind[]): void {
    this.broadcast(`project:${projectId}`, {
      type: "changed",
      entity: "project",
      id: projectId,
      changes,
    });
  }

  notifyEnvironment(environmentId: string, changes: EnvironmentChangeKind[]): void {
    this.broadcast(`environment:${environmentId}`, {
      type: "changed",
      entity: "environment",
      id: environmentId,
      changes,
    });
  }

  notifyCommand(hostId: string): void {
    const conn = this.findDaemonByHostId(hostId);
    if (conn) {
      conn.ws.send(JSON.stringify({ type: "commands-available" }));
    }
    // Wake any long-poll waiters for this host
    const callbacks = this.commandNotifyCallbacks.get(hostId);
    if (callbacks) {
      for (const cb of callbacks) cb();
      callbacks.clear();
    }
  }

  notifySystem(changes: SystemChangeKind[]): void {
    this.broadcast("system", {
      type: "changed",
      entity: "system",
      changes,
    });
  }

  // --- Client WS management ---

  addClient(ws: WSContext): void {
    this.clientSockets.set(ws, new Set());
  }

  removeClient(ws: WSContext): void {
    const subs = this.clientSockets.get(ws);
    if (subs) {
      for (const key of subs) {
        const clients = this.subscriptionClients.get(key);
        if (clients) {
          clients.delete(ws);
          if (clients.size === 0) this.subscriptionClients.delete(key);
        }
      }
    }
    this.clientSockets.delete(ws);
  }

  subscribe(ws: WSContext, entity: string, id?: string): void {
    const key = id ? `${entity}:${id}` : entity;
    const subs = this.clientSockets.get(ws);
    if (subs) subs.add(key);

    let clients = this.subscriptionClients.get(key);
    if (!clients) {
      clients = new Set();
      this.subscriptionClients.set(key, clients);
    }
    clients.add(ws);
  }

  unsubscribe(ws: WSContext, entity: string, id?: string): void {
    const key = id ? `${entity}:${id}` : entity;
    const subs = this.clientSockets.get(ws);
    if (subs) subs.delete(key);

    const clients = this.subscriptionClients.get(key);
    if (clients) {
      clients.delete(ws);
      if (clients.size === 0) this.subscriptionClients.delete(key);
    }
  }

  // --- Daemon WS management ---

  addDaemon(sessionId: string, hostId: string, ws: WSContext): void {
    const existing = this.daemonConnections.get(sessionId);
    if (existing) {
      try { existing.ws.close(1000, "replaced"); } catch { /* ignore */ }
    }
    this.daemonConnections.set(sessionId, { sessionId, hostId, ws });
  }

  removeDaemon(sessionId: string): void {
    this.daemonConnections.delete(sessionId);
  }

  sendToDaemon(sessionId: string, message: unknown): boolean {
    const conn = this.daemonConnections.get(sessionId);
    if (!conn) return false;
    conn.ws.send(JSON.stringify(message));
    return true;
  }

  findDaemonByHostId(hostId: string): DaemonConnection | undefined {
    for (const conn of this.daemonConnections.values()) {
      if (conn.hostId === hostId) return conn;
    }
    return undefined;
  }

  isDaemonConnected(hostId: string): boolean {
    return this.findDaemonByHostId(hostId) !== undefined;
  }

  // --- Command result waiting ---

  waitForCommandResult(commandId: string, timeoutMs: number): Promise<CommandWaitResult> {
    return new Promise<CommandWaitResult>((resolve) => {
      const timer = setTimeout(() => {
        this.commandWaiters.delete(commandId);
        resolve({
          ok: false,
          errorCode: "command_timeout",
          errorMessage: `Command timed out after ${timeoutMs}ms`,
        });
      }, timeoutMs);

      this.commandWaiters.set(commandId, { resolve, timer });
    });
  }

  resolveCommandResult(commandId: string, result: CommandWaitResult): void {
    const waiter = this.commandWaiters.get(commandId);
    if (waiter) {
      clearTimeout(waiter.timer);
      this.commandWaiters.delete(commandId);
      waiter.resolve(result);
    }
  }

  // --- Long-poll support for command fetching ---

  waitForCommands(hostId: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        const callbacks = this.commandNotifyCallbacks.get(hostId);
        if (callbacks) {
          callbacks.delete(cb);
          if (callbacks.size === 0) this.commandNotifyCallbacks.delete(hostId);
        }
        resolve();
      }, timeoutMs);

      const cb = () => {
        clearTimeout(timer);
        resolve();
      };

      let callbacks = this.commandNotifyCallbacks.get(hostId);
      if (!callbacks) {
        callbacks = new Set();
        this.commandNotifyCallbacks.set(hostId, callbacks);
      }
      callbacks.add(cb);
    });
  }

  // --- Private ---

  private broadcast(subscriptionKey: string, message: ServerMessage): void {
    const clients = this.subscriptionClients.get(subscriptionKey);
    if (!clients) return;
    const payload = JSON.stringify(message);
    for (const ws of clients) {
      try { ws.send(payload); } catch { /* client disconnected */ }
    }
  }
}
