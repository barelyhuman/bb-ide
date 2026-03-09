import {
  EnvironmentAgentRuntime,
  type EnvironmentAgentRuntimeOptions,
} from "./runtime.js";
import {
  createEnvironmentAgentHttpServer,
  type EnvironmentAgentHttpServer,
} from "./http-server.js";
import {
  createEnvironmentAgentFileLogger,
  resolveEnvironmentAgentLogFilePath,
} from "./file-logger.js";

export interface EnvironmentAgentServiceCliOptions {
  providerCommand?: string;
  providerArgs?: string[];
  providerLaunchCommand?: string;
  providerLaunchArgs?: string[];
  httpPort?: string;
  httpHost?: string;
}

export interface EnvironmentAgentServiceOptions {
  runtime: EnvironmentAgentRuntimeOptions;
  server: {
    host: string;
    port: number;
    bearerToken: string;
  };
  logging: {
    filePath: string;
  };
}

const BEANBAG_ENVIRONMENT_AGENT_AUTH_TOKEN = "BEANBAG_ENVIRONMENT_AGENT_AUTH_TOKEN";
const BEANBAG_DAEMON_URL = "BEANBAG_DAEMON_URL";

export function resolveEnvironmentAgentServiceOptions(args: {
  cli: EnvironmentAgentServiceCliOptions;
  env: NodeJS.ProcessEnv;
}): EnvironmentAgentServiceOptions {
  const authToken = args.env[BEANBAG_ENVIRONMENT_AGENT_AUTH_TOKEN]?.trim();
  if (!authToken) {
    throw new Error(`Missing required ${BEANBAG_ENVIRONMENT_AGENT_AUTH_TOKEN}`);
  }

  const httpPortRaw = args.cli.httpPort?.trim();
  if (!httpPortRaw) {
    throw new Error("Missing required --http-port");
  }
  const httpPort = Number.parseInt(httpPortRaw, 10);
  if (!Number.isFinite(httpPort) || httpPort < 0) {
    throw new Error("Invalid --http-port");
  }

  return {
    runtime: {
      threadId: args.env.BB_THREAD_ID,
      projectId: args.env.BB_PROJECT_ID,
      environmentId: args.env.BB_ENVIRONMENT_ID,
      daemonConnection: {
        daemonUrl: args.env[BEANBAG_DAEMON_URL],
        authToken,
        threadId: args.env.BB_THREAD_ID,
        projectId: args.env.BB_PROJECT_ID,
        environmentId: args.env.BB_ENVIRONMENT_ID,
      },
      providerCommand: args.cli.providerCommand?.trim(),
      providerArgs: args.cli.providerArgs ?? [],
      providerLaunchCommand: args.cli.providerLaunchCommand?.trim(),
      providerLaunchArgs: args.cli.providerLaunchArgs ?? [],
    },
    server: {
      host: args.cli.httpHost?.trim() || "127.0.0.1",
      port: httpPort,
      bearerToken: authToken,
    },
    logging: {
      filePath: resolveEnvironmentAgentLogFilePath(args.env),
    },
  };
}

export async function startEnvironmentAgentService(
  options: EnvironmentAgentServiceOptions,
): Promise<{
  runtime: EnvironmentAgentRuntime;
  server: EnvironmentAgentHttpServer;
}> {
  const logger = createEnvironmentAgentFileLogger(options.logging.filePath);
  logger.log("info", "environment-agent starting", {
    threadId: options.runtime.threadId,
    projectId: options.runtime.projectId,
    environmentId: options.runtime.environmentId,
    daemonUrl: options.runtime.daemonConnection?.daemonUrl,
  });

  const runtime = new EnvironmentAgentRuntime({
    ...options.runtime,
    onStdoutLine: (line) => {
      logger.log("info", "provider stdout", { line });
      options.runtime.onStdoutLine?.(line);
    },
    onStderrLine: (line) => {
      logger.log("warn", "provider stderr", { line });
      options.runtime.onStderrLine?.(line);
    },
  });
  runtime.subscribeToEvents((event) => {
    logger.log("info", "environment-agent event", {
      sequence: event.sequence,
      type: event.event.type,
      threadId: event.threadId,
    });
  });
  runtime.start();

  const server = await createEnvironmentAgentHttpServer({
    runtime,
    host: options.server.host,
    port: options.server.port,
    bearerToken: options.server.bearerToken,
  });
  logger.log("info", "environment-agent http listening", {
    baseUrl: server.baseUrl,
    logFilePath: options.logging.filePath,
  });

  return { runtime, server };
}
