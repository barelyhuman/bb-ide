import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

export const bundleTargets = [
  {
    entryPoint: resolve(packageRoot, "src", "index.ts"),
    label: "daemon",
    outfile: resolve(packageRoot, "dist", "daemon-bundle.mjs"),
  },
  {
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "agent-runtime",
      "src",
      "claude-code",
      "bridge",
      "bridge.ts",
    ),
    label: "claude-code bridge",
    outfile: resolve(packageRoot, "dist", "bb-claude-code-bridge.mjs"),
  },
  {
    entryPoint: resolve(
      workspaceRoot,
      "packages",
      "agent-runtime",
      "src",
      "pi",
      "bridge",
      "bridge.ts",
    ),
    label: "pi bridge",
    outfile: resolve(packageRoot, "dist", "bb-pi-bridge.mjs"),
  },
];
