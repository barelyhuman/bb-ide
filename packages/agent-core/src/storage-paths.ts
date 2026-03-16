import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const BB_ROOT_ENV = "BB_ROOT";

/** @deprecated Use BB_ROOT_ENV instead. */
export const BEANBAG_ROOT_ENV = "BEANBAG_ROOT";

let _deprecationWarned = false;

export function expandHomeDirectory(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}

export function resolveBeanbagRoot(env: NodeJS.ProcessEnv = process.env): string {
  const preferred = env[BB_ROOT_ENV]?.trim();
  if (preferred) {
    return resolve(expandHomeDirectory(preferred));
  }
  const legacy = env[BEANBAG_ROOT_ENV]?.trim();
  if (legacy) {
    if (!_deprecationWarned) {
      _deprecationWarned = true;
      process.stderr.write("Warning: BEANBAG_ROOT is deprecated, use BB_ROOT\n");
    }
    return resolve(expandHomeDirectory(legacy));
  }
  return resolve(homedir(), ".beanbag");
}

/** @internal Reset deprecation warning state (for tests). */
export function __testOnly__resetDeprecationWarning(): void {
  _deprecationWarned = false;
}

export function resolveBeanbagPath(
  env: NodeJS.ProcessEnv = process.env,
  ...segments: readonly string[]
): string {
  return join(resolveBeanbagRoot(env), ...segments);
}
