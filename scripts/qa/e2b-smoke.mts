import { setTimeout as delay } from "node:timers/promises";
import {
  createSandbox,
  resumeSandbox,
  runSandboxCommand,
  startBackgroundProcess,
  writeSandboxFile,
} from "../../packages/sandbox-host/src/index.ts";
import { resolveSandboxImageTemplate } from "../../packages/sandbox-image/src/index.ts";

const SMOKE_TIMEOUT_MS = 5 * 60 * 1000;
const SMOKE_SERVER_PORT = 9999;
const SMOKE_SERVER_URL = `http://127.0.0.1:${SMOKE_SERVER_PORT}`;

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }
  return String(error);
}

function isReachablePublicUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1";
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\"'\"'`)}'`;
}

async function waitForCommandSuccess(
  runCommand: () => Promise<void>,
  label: string,
): Promise<void> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      await runCommand();
      return;
    } catch (error) {
      lastError = error;
      await delay(2_000);
    }
  }

  throw new Error(`${label} never became ready: ${formatError(lastError)}`);
}

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    throw new Error("E2B_API_KEY is required");
  }

  console.log("Creating sandbox");
  const sandbox = await createSandbox({
    timeoutMs: SMOKE_TIMEOUT_MS,
  });
  let activeSandbox = sandbox;

  try {
    console.log(`Created sandbox ${sandbox.sandboxId}`);

    console.log("Writing /tmp/hello.txt");
    await writeSandboxFile(sandbox, "/tmp/hello.txt", "hello from bb");

    console.log("Reading /tmp/hello.txt");
    const helloResult = await runSandboxCommand(sandbox, "cat /tmp/hello.txt");
    if (helloResult.stdout.trim() !== "hello from bb") {
      throw new Error(`Unexpected hello output: ${helloResult.stdout}`);
    }

    console.log("Checking Node.js availability");
    const nodeResult = await runSandboxCommand(sandbox, "node --version");
    if (!nodeResult.stdout.trim().startsWith("v")) {
      throw new Error(`Unexpected node version output: ${nodeResult.stdout}`);
    }

    const templateId = resolveSandboxImageTemplate();
    console.log(`Checking template tools for ${templateId}`);
    await runSandboxCommand(sandbox, "codex --version");
    await runSandboxCommand(sandbox, "git --version");
    await runSandboxCommand(sandbox, "gh --version");

    console.log("Writing fake daemon server");
    await writeSandboxFile(
      sandbox,
      "/tmp/fake-daemon.mjs",
      [
        'import { createServer } from "node:http";',
        "const server = createServer((_, res) => {",
        '  res.writeHead(200, { "content-type": "text/plain" });',
        '  res.end("ok");',
        "});",
        `server.listen(${SMOKE_SERVER_PORT}, () => console.log("ready"));`,
      ].join("\n"),
    );

    console.log("Starting fake daemon server");
    const handle = await startBackgroundProcess(
      sandbox,
      "node /tmp/fake-daemon.mjs",
      { onStdout: (data) => process.stdout.write(data) },
    );

    console.log(`Started background process ${handle.pid}`);
    await waitForCommandSuccess(
      async () => {
        const result = await runSandboxCommand(
          sandbox,
          `curl -sf ${SMOKE_SERVER_URL}`,
        );
        if (result.stdout.trim() !== "ok") {
          throw new Error(`Unexpected health response: ${result.stdout}`);
        }
      },
      "fake daemon health check",
    );

    console.log("Pausing sandbox");
    await sandbox.pause();

    console.log("Resuming sandbox");
    const resumedSandbox = await resumeSandbox(sandbox.sandboxId, {
      timeoutMs: SMOKE_TIMEOUT_MS,
    });
    activeSandbox = resumedSandbox;

    console.log("Checking daemon after resume");
    try {
      await waitForCommandSuccess(
        async () => {
          const result = await runSandboxCommand(
            resumedSandbox,
            `curl -sf ${SMOKE_SERVER_URL}`,
          );
          if (result.stdout.trim() !== "ok") {
            throw new Error(`Unexpected health response: ${result.stdout}`);
          }
        },
        "post-resume daemon health check",
      );
    } catch {
      console.log("Daemon did not survive pause, restarting it");
      await startBackgroundProcess(resumedSandbox, "node /tmp/fake-daemon.mjs");
      await waitForCommandSuccess(
        async () => {
          const result = await runSandboxCommand(
            resumedSandbox,
            `curl -sf ${SMOKE_SERVER_URL}`,
          );
          if (result.stdout.trim() !== "ok") {
            throw new Error(`Unexpected health response: ${result.stdout}`);
          }
        },
        "restarted daemon health check",
      );
    }

    const publicUrl = process.env.BB_PUBLIC_URL ?? "";
    if (isReachablePublicUrl(publicUrl)) {
      const healthUrl = new URL("/health", publicUrl).toString();
      console.log(`Checking sandbox to server connectivity via ${publicUrl}`);
      await runSandboxCommand(
        resumedSandbox,
        `curl -sf ${shellQuote(healthUrl)}`,
      );
    } else {
      console.log("Skipping sandbox to server connectivity check");
    }
  } finally {
    console.log("Destroying sandbox");
    await activeSandbox.kill().catch((error) => {
      console.error(`Failed to destroy sandbox: ${formatError(error)}`);
    });
  }
}

void main().then(
  () => {
    console.log("E2B smoke test passed");
  },
  (error) => {
    console.error("E2B smoke test failed");
    console.error(formatError(error));
    process.exitCode = 1;
  },
);
