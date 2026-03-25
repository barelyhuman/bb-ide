export interface LoggerLike {
  info: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

export interface HostDaemonIdentity {
  hostId: string;
  hostName: string;
  instanceId: string;
}

export interface SignalSource {
  on(event: NodeJS.Signals, listener: () => void): unknown;
  off(event: NodeJS.Signals, listener: () => void): unknown;
}

export interface CreateDaemonOptions {
  identity: HostDaemonIdentity;
  logger: LoggerLike;
  releaseLock: () => Promise<void>;
  flushEventBuffer?: () => Promise<void>;
  shutdownRuntimes?: () => Promise<void>;
  onStart?: () => Promise<void>;
  signalSource?: SignalSource;
}

export interface HostDaemon {
  readonly identity: HostDaemonIdentity;
  start(): Promise<void>;
  shutdown(reason?: string): Promise<void>;
  waitUntilStopped(): Promise<void>;
}

const TERMINATION_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM"];

export function createDaemon(options: CreateDaemonOptions): HostDaemon {
  let started = false;
  let shutdownPromise: Promise<void> | null = null;

  let resolveStopped: (() => void) | undefined;
  const stopped = new Promise<void>((resolve) => {
    resolveStopped = resolve;
  });

  const signalSource = options.signalSource ?? process;
  const listeners = new Map<NodeJS.Signals, () => void>();

  function unregisterSignalHandlers(): void {
    for (const [signal, listener] of listeners) {
      signalSource.off(signal, listener);
    }
    listeners.clear();
  }

  async function shutdown(reason = "shutdown"): Promise<void> {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      unregisterSignalHandlers();
      options.logger.info({ reason }, "Shutting down host daemon");

      let failure: unknown;
      const steps = [
        {
          name: "flushEventBuffer",
          run: options.flushEventBuffer,
        },
        {
          name: "shutdownRuntimes",
          run: options.shutdownRuntimes,
        },
        {
          name: "releaseLock",
          run: options.releaseLock,
        },
      ] as const;

      for (const step of steps) {
        if (!step.run) {
          continue;
        }

        try {
          await step.run();
        } catch (error) {
          failure ??= error;
          options.logger.error({ err: error, step: step.name }, "Shutdown step failed");
        }
      }

      resolveStopped?.();

      if (failure) {
        throw failure;
      }
    })();

    return shutdownPromise;
  }

  return {
    identity: options.identity,
    async start(): Promise<void> {
      if (started) {
        return;
      }

      for (const signal of TERMINATION_SIGNALS) {
        const listener = () => {
          void shutdown(signal);
        };
        listeners.set(signal, listener);
        signalSource.on(signal, listener);
      }

      try {
        await options.onStart?.();
        started = true;
        options.logger.info(
          { identity: options.identity },
          "Host daemon started",
        );
      } catch (error) {
        unregisterSignalHandlers();
        throw error;
      }
    },
    shutdown,
    waitUntilStopped(): Promise<void> {
      return stopped;
    },
  };
}
