import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SandboxDaemonArtifacts } from "./types.js";

interface LocalSandboxDaemonArtifact {
  label: string;
  localPath: string;
}

function resolveSandboxHostPackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function resolveWorkspaceRoot(): string {
  return resolve(resolveSandboxHostPackageRoot(), "..", "..");
}

function resolveHostDaemonDistPath(fileName: string): string {
  return resolve(resolveWorkspaceRoot(), "apps", "host-daemon", "dist", fileName);
}

async function readBundleArtifact(
  artifact: LocalSandboxDaemonArtifact,
): Promise<string> {
  try {
    return await readFile(artifact.localPath, "utf8");
  } catch {
    throw new Error(
      `Missing ${artifact.label} bundle at ${artifact.localPath}. Run pnpm exec turbo run bundle --filter=@bb/host-daemon before provisioning sandbox hosts.`,
    );
  }
}

export async function loadSandboxDaemonArtifacts(): Promise<SandboxDaemonArtifacts> {
  const daemon = await readBundleArtifact({
    label: "daemon",
    localPath: resolveHostDaemonDistPath("daemon-bundle.mjs"),
  });
  const claudeCodeBridge = await readBundleArtifact({
    label: "claude-code bridge",
    localPath: resolveHostDaemonDistPath("bb-claude-code-bridge.mjs"),
  });
  const piBridge = await readBundleArtifact({
    label: "pi bridge",
    localPath: resolveHostDaemonDistPath("bb-pi-bridge.mjs"),
  });

  return {
    claudeCodeBridge,
    daemon,
    piBridge,
  };
}
