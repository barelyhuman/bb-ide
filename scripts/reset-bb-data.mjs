import { existsSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

function expandHomeDirectory(path) {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

function resolveBbRoot(env = process.env) {
  const preferred = env.BB_ROOT?.trim();
  if (preferred) {
    return resolve(expandHomeDirectory(preferred));
  }
  return resolveDefaultBbRoot();
}

function resolveDevBbRoot(env = process.env) {
  const preferred = env.BB_DEV_ROOT?.trim();
  if (preferred) {
    return resolve(expandHomeDirectory(preferred));
  }
  return resolveDefaultDevBbRoot();
}

function resolveDefaultBbRoot() {
  return resolve(homedir(), ".bb");
}

function resolveDefaultDevBbRoot() {
  return resolve(homedir(), ".bb-dev");
}

function printHelp() {
  console.log(`Reset bb-managed local data

Usage:
  node scripts/reset-bb-data.mjs [--all] [--yes]

Options:
  --all   Remove both the default start and dev data roots.
  --yes   Skip the interactive confirmation prompt.

Notes:
  - Removes only bb-managed state directories such as ~/.bb and ~/.bb-dev.
  - Does not remove provider auth/config managed by other tools (Codex, Claude, OpenAI).
  - Respects BB_ROOT for single-root resets.
`);
}

function uniquePaths(paths) {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function ensureSafeTargets(targets) {
  const home = resolve(homedir());
  for (const target of targets) {
    if (!isAbsolute(target)) {
      throw new Error(`Refusing to remove non-absolute path: ${target}`);
    }
    if (target === "/" || target === home || target.length < home.length + 2) {
      throw new Error(`Refusing to remove unsafe path: ${target}`);
    }
  }
}

async function confirmReset(targets) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Interactive confirmation requires a TTY. Re-run with --yes to confirm.");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    console.log("This will permanently delete bb-managed local data at:");
    for (const target of targets) {
      console.log(`  - ${target}`);
    }
    console.log("");
    console.log("Provider auth/config files managed outside bb will be left untouched.");
    const answer = await rl.question('Type "reset" to continue: ');
    return answer.trim() === "reset";
  } finally {
    rl.close();
  }
}

async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has("--help") || args.has("-h")) {
    printHelp();
    return;
  }

  const targets = args.has("--all")
    ? uniquePaths([resolveDefaultBbRoot(), resolveDefaultDevBbRoot(), resolveBbRoot(process.env)])
    : [resolveBbRoot(process.env)];

  ensureSafeTargets(targets);

  const proceed = args.has("--yes") ? true : await confirmReset(targets);
  if (!proceed) {
    console.log("Reset cancelled.");
    return;
  }

  let removedCount = 0;
  for (const target of targets) {
    if (!existsSync(target)) {
      console.log(`Skipped missing path: ${target}`);
      continue;
    }
    rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    console.log(`Removed: ${target}`);
    removedCount += 1;
  }

  if (removedCount === 0) {
    console.log("No bb-managed data directories were present.");
    return;
  }

  console.log("bb-managed local data reset complete.");
}

await main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
