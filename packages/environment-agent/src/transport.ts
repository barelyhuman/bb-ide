import type { ChildProcess } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

export interface JsonLineTransportHandlers {
  onLine: (line: string) => void;
  onStderrLine?: (line: string) => void;
  onClose?: (reason?: Error) => void;
}

export interface JsonLineTransport {
  setHandlers(handlers: JsonLineTransportHandlers): void;
  send(line: string): void;
  close(reason?: Error): void;
}

export function createChildProcessJsonLineTransport(
  child: ChildProcess,
): JsonLineTransport {
  let handlers: JsonLineTransportHandlers | undefined;
  let stdoutRl: Interface | undefined;
  let stderrRl: Interface | undefined;
  let closed = false;

  const close = (reason?: Error) => {
    if (closed) return;
    closed = true;
    stdoutRl?.close();
    stdoutRl = undefined;
    stderrRl?.close();
    stderrRl = undefined;
    handlers?.onClose?.(reason);
  };

  if (child.stdout) {
    stdoutRl = createInterface({ input: child.stdout });
    stdoutRl.on("line", (line) => {
      handlers?.onLine(line);
    });
  }

  if (child.stderr) {
    stderrRl = createInterface({ input: child.stderr });
    stderrRl.on("line", (line) => {
      handlers?.onStderrLine?.(line);
    });
  }

  child.once("exit", (code, signal) => {
    close(
      new Error(
        `Process exited (${signal ?? code ?? "unknown"})`,
      ),
    );
  });

  child.once("error", (error) => {
    close(error);
  });

  return {
    setHandlers(nextHandlers) {
      handlers = nextHandlers;
    },
    send(line) {
      if (closed) {
        throw new Error("Transport is closed");
      }
      if (!child.stdin) {
        throw new Error("Child process has no stdin");
      }
      child.stdin.write(`${line}\n`);
    },
    close,
  };
}
