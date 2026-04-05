import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Sandbox } from "e2b";
import type { Sandbox as E2BSandbox } from "e2b";

const timeoutMs = 5 * 60 * 1000;
const runSandboxImageTests = process.env.SANDBOX_IMAGE_TEST === "1";
const describeSandboxImage = runSandboxImageTests ? describe : describe.skip;

interface SandboxImageToolCheck {
  name: string;
  versionCommand: string;
  pathCommand?: string;
}

interface SandboxImageToolResult {
  path?: string;
  version: string;
}

type SandboxImageToolResultMap = Record<string, SandboxImageToolResult>;

const sandboxImageToolChecks: SandboxImageToolCheck[] = [
  {
    name: "codex",
    pathCommand: "which codex",
    versionCommand: "codex --version",
  },
  {
    name: "curl",
    pathCommand: "which curl",
    versionCommand: "sh -lc 'curl --version | head -n 1'",
  },
  {
    name: "g++",
    pathCommand: "which g++",
    versionCommand: "sh -lc 'g++ --version | head -n 1'",
  },
  {
    name: "gh",
    pathCommand: "which gh",
    versionCommand: "gh --version",
  },
  {
    name: "git",
    pathCommand: "which git",
    versionCommand: "git --version",
  },
  {
    name: "make",
    pathCommand: "which make",
    versionCommand: "sh -lc 'make --version | head -n 1'",
  },
  {
    name: "node",
    pathCommand: "which node",
    versionCommand: "node --version",
  },
  {
    name: "npm",
    pathCommand: "which npm",
    versionCommand: "npm --version",
  },
  {
    name: "pkg-config",
    pathCommand: "which pkg-config",
    versionCommand: "pkg-config --version",
  },
  {
    name: "pnpm",
    pathCommand: "which pnpm",
    versionCommand: "pnpm --version",
  },
  {
    name: "python3",
    pathCommand: "which python3",
    versionCommand: "python3 --version",
  },
  {
    name: "rg",
    pathCommand: "which rg",
    versionCommand: "rg --version",
  },
];

function resolveSandboxImageTestTemplate(): string {
  const template = process.env.E2B_TEMPLATE?.trim();
  if (template && template.length > 0) {
    return template;
  }

  throw new Error("SANDBOX_IMAGE_TEST requires E2B_TEMPLATE to be configured");
}

async function runCommand(
  sandbox: E2BSandbox,
  command: string,
): Promise<string> {
  const result = await sandbox.commands.run(command, { cwd: "." });
  return result.stdout.trim();
}

async function collectSandboxImageToolResults(
  sandbox: E2BSandbox,
): Promise<SandboxImageToolResultMap> {
  const results: SandboxImageToolResultMap = {};

  for (const check of sandboxImageToolChecks) {
    const version = await runCommand(sandbox, check.versionCommand);
    const path = check.pathCommand
      ? await runCommand(sandbox, check.pathCommand)
      : undefined;

    results[check.name] = {
      ...(path !== undefined ? { path } : {}),
      version,
    };
  }

  return results;
}

describeSandboxImage("sandbox image", { timeout: timeoutMs }, () => {
  let sandbox: E2BSandbox;

  beforeAll(async () => {
    sandbox = await Sandbox.create(resolveSandboxImageTestTemplate(), {
      timeoutMs,
    });
  }, timeoutMs);

  afterAll(async () => {
    await sandbox?.kill().catch(() => undefined);
  }, 60_000);

  it("matches the expected entrypoint", async () => {
    const entrypoint = await runCommand(sandbox, "ps -p 1 -o args=");
    expect(entrypoint).toMatchSnapshot();
  });

  it("matches the expected tool versions and locations", async () => {
    const toolResults = await collectSandboxImageToolResults(sandbox);
    expect(toolResults).toMatchSnapshot();
  });

  it("supports pnpm installs", async () => {
    const output = await runCommand(
      sandbox,
      [
        "sh -lc",
        "'rm -rf /tmp/bb-image-pnpm-test",
        "&& mkdir -p /tmp/bb-image-pnpm-test",
        "&& cd /tmp/bb-image-pnpm-test",
        `&& printf '%s' '{\"name\":\"bb-image-pnpm-test\",\"private\":true}' > package.json`,
        "&& pnpm add axios'",
      ].join(" "),
    );
    expect(output).toContain("axios");

    const lockfile = await runCommand(
      sandbox,
      "sh -lc 'test -f /tmp/bb-image-pnpm-test/pnpm-lock.yaml && echo present'",
    );
    expect(lockfile).toBe("present");
  });
});
