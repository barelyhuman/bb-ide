import { execFile as execFileCallback, spawn } from "node:child_process";
import { closeSync, openSync } from "node:fs";
import fs from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);

export const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function isNodeError(error) {
  return error instanceof Error;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

async function resolveProjectEnvCandidates() {
  const candidates = new Set([path.join(repoRoot, ".env")]);
  const gitMetadataPath = path.join(repoRoot, ".git");

  try {
    const gitMetadata = await fs.stat(gitMetadataPath);
    if (!gitMetadata.isFile()) {
      return [...candidates];
    }

    const gitdirPointer = await fs.readFile(gitMetadataPath, "utf8");
    const match = /^gitdir:\s*(.+)\s*$/m.exec(gitdirPointer);
    if (!match?.[1]) {
      return [...candidates];
    }

    const worktreeGitDir = path.resolve(repoRoot, match[1]);
    const commonGitDir = path.dirname(path.dirname(worktreeGitDir));
    candidates.add(path.join(path.dirname(commonGitDir), ".env"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [...candidates];
    }
    throw error;
  }

  return [...candidates];
}

export async function createTestGitRepo(repoDir) {
  await fs.mkdir(repoDir, { recursive: true });
  await runGit(repoDir, ["init", "--initial-branch", "main"]);
  await runGit(repoDir, ["config", "user.email", "standalone-qa@example.com"]);
  await runGit(repoDir, ["config", "user.name", "BB Standalone QA"]);
  await fs.writeFile(path.join(repoDir, "alpha.txt"), "alpha\n", "utf8");
  await fs.writeFile(
    path.join(repoDir, "beta.md"),
    "# Beta\n\nStandalone QA repo.\n",
    "utf8",
  );
  await runGit(repoDir, ["add", "."]);
  await runGit(repoDir, ["commit", "-m", "Initial commit"]);
  return repoDir;
}

export async function createProject(serverUrl, project) {
  const response = await fetch(`${serverUrl}/api/v1/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(project),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to create project: ${response.status} ${await response.text()}`,
    );
  }
  return response.json();
}

export async function killProcess(pid) {
  if (!pid) {
    return;
  }

  if (!(await isProcessRunning(pid))) {
    return;
  }

  process.kill(pid, "SIGTERM");
  await waitFor(async () => !(await isProcessRunning(pid)), {
    timeoutMs: 5_000,
    description: `process ${pid} to exit`,
  }).catch(async () => {
    if (await isProcessRunning(pid)) {
      process.kill(pid, "SIGKILL");
      await waitFor(async () => !(await isProcessRunning(pid)), {
        timeoutMs: 5_000,
        description: `process ${pid} to exit after SIGKILL`,
      });
    }
  });
}

export async function loadDotEnv() {
  const loaded = {};

  for (const candidate of await resolveProjectEnvCandidates()) {
    try {
      const content = await fs.readFile(candidate, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) {
          continue;
        }
        const equalsIndex = trimmed.indexOf("=");
        if (equalsIndex < 0) {
          continue;
        }
        const key = trimmed.slice(0, equalsIndex).trim();
        const value = trimmed.slice(equalsIndex + 1).trim();
        if (key && !(key in process.env)) {
          process.env[key] = value;
          loaded[key] = value;
        }
      }
      return {
        loaded,
        path: candidate,
      };
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }
  }

  return {
    loaded,
    path: null,
  };
}

export async function reservePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Failed to reserve port"));
        return;
      }
      const port = address.port;
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(port);
      });
    });
  });
}

export async function runGit(cwd, args) {
  await execFile("git", args, { cwd });
}

export function spawnLoggedProcess(options) {
  const logFd = openSync(options.logPath, "a");
  try {
    const child = spawn(options.command, options.args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", logFd, logFd],
    });
    child.unref();
    return child;
  } finally {
    closeSync(logFd);
  }
}

export function buildDaemonRestartCommand(args) {
  return [
    `BB_DATA_DIR=${shellQuote(args.dataDir)}`,
    `BB_HOST_DAEMON_PORT=${shellQuote(String(args.daemonPort))}`,
    `BB_SECRET_TOKEN=${shellQuote(args.authToken)}`,
    `BB_SERVER_URL=${shellQuote(args.serverUrl)}`,
    `node ${shellQuote(args.entrypoint)}`,
    `>> ${shellQuote(args.logPath)} 2>&1 &`,
  ].join(" ");
}

export async function waitFor(check, options) {
  const startedAt = Date.now();

  while (Date.now() - startedAt <= options.timeoutMs) {
    const result = await check();
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 100));
  }

  throw new Error(`Timed out waiting for ${options.description}`);
}

export async function waitForConnectedHost(serverUrl) {
  return waitFor(
    async () => {
      let response;
      try {
        response = await fetch(`${serverUrl}/api/v1/hosts`);
      } catch {
        return null;
      }
      if (!response.ok) {
        return null;
      }
      const hosts = await response.json();
      return hosts.find((host) => host.status === "connected") ?? null;
    },
    {
      timeoutMs: 10_000,
      description: "host daemon connection",
    },
  );
}

export async function waitForServerReady(serverUrl) {
  return waitFor(
    async () => {
      try {
        const response = await fetch(`${serverUrl}/api/v1/system/config`);
        return response.ok ? true : null;
      } catch {
        return null;
      }
    },
    {
      timeoutMs: 10_000,
      description: "server health check",
    },
  );
}

async function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") {
      return false;
    }
    throw error;
  }
}
