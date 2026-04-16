import { type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { devEnvConfig } from "@bb/config/dev-env";
import { startCloudflared } from "./cloudflared.js";
import {
  createDefaultDevEnvStatusDependencies,
  createDevEnvStatusApp,
  createRuntime,
  type DevEnvRuntime,
  type DevEnvStatusDependencies,
} from "./status-api.js";

interface StatusServer {
  close(): Promise<void>;
}

interface ShutdownArgs {
  statusServer: StatusServer;
  tunnel: ChildProcess | null;
}

type ShutdownSignal = "SIGINT" | "SIGTERM";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

async function startStatusServer(
  runtime: DevEnvRuntime,
  dependencies: DevEnvStatusDependencies,
): Promise<StatusServer> {
  const app = createDevEnvStatusApp(runtime, dependencies);
  const { server } = await new Promise<{
    server: ReturnType<typeof serve>;
  }>((resolveServer, rejectServer) => {
    const startedServer = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: devEnvConfig.BB_DEV_ENV_PORT,
      },
      () => resolveServer({ server: startedServer }),
    );
    startedServer.on("error", rejectServer);
  });

  process.stdout.write(
    `[dev-env] Status API listening at http://127.0.0.1:${devEnvConfig.BB_DEV_ENV_PORT}\n`,
  );

  return {
    close() {
      return new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => {
          if (error) {
            rejectClose(error);
            return;
          }
          resolveClose();
        });
      });
    },
  };
}

function installShutdownHandlers(args: ShutdownArgs): void {
  let shuttingDown = false;
  const shutdown = (signal: ShutdownSignal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
      args.tunnel?.kill(signal);
      try {
        await args.statusServer.close();
      } finally {
        process.exit(0);
      }
    })();
  };

  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const dependencies = createDefaultDevEnvStatusDependencies({ repoRoot });
  const runtime = await createRuntime(dependencies);
  const tunnel = startCloudflared({
    tunnelToken: devEnvConfig.DEV_CLOUDFLARED_TUNNEL_TOKEN,
  });
  const statusServer = await startStatusServer(runtime, dependencies);
  installShutdownHandlers({ statusServer, tunnel });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
