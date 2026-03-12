import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const BEANBAG_ROOT_ENV = "BEANBAG_ROOT";

export function expandHomeDirectory(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function resolveBeanbagRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configuredRoot = env[BEANBAG_ROOT_ENV]?.trim();
  if (!configuredRoot) {
    return resolve(homedir(), ".beanbag");
  }
  return resolve(expandHomeDirectory(configuredRoot));
}

export function resolveBeanbagPath(
  env: NodeJS.ProcessEnv = process.env,
  ...segments: readonly string[]
): string {
  return join(resolveBeanbagRoot(env), ...segments);
}
