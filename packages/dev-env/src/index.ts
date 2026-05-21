import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { loadDevEnvConfig } from "@bb/config/dev-env";
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
}

interface StartStatusServerArgs {
  devEnvPort: number;
  dependencies: DevEnvStatusDependencies;
  runtime: DevEnvRuntime;
}

type ShutdownSignal = "SIGINT" | "SIGTERM";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);

async function startStatusServer(
  args: StartStatusServerArgs,
): Promise<StatusServer> {
  const app = createDevEnvStatusApp(args.runtime, args.dependencies);
  const { server } = await new Promise<{
    server: ReturnType<typeof serve>;
  }>((resolveServer, rejectServer) => {
    const startedServer = serve(
      {
        fetch: app.fetch,
        hostname: "127.0.0.1",
        port: args.devEnvPort,
      },
      () => resolveServer({ server: startedServer }),
    );
    startedServer.on("error", rejectServer);
  });

  process.stdout.write(
    `[dev-env] Status API listening at http://127.0.0.1:${args.devEnvPort}\n`,
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
  const shutdown = (_signal: ShutdownSignal) => {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    void (async () => {
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
  const devEnvConfig = loadDevEnvConfig();
  const devEnvPort = devEnvConfig.BB_DEV_ENV_PORT;
  if (devEnvPort === undefined) {
    throw new Error(
      "BB_DEV_ENV_PORT is required to run the dev-env status API",
    );
  }
  const dependencies = createDefaultDevEnvStatusDependencies({ repoRoot });
  const runtime = await createRuntime(dependencies);
  const statusServer = await startStatusServer({
    dependencies,
    devEnvPort,
    runtime,
  });
  installShutdownHandlers({ statusServer });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
