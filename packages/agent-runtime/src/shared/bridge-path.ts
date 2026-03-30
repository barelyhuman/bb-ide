import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveBridgePathArgs {
  importMetaUrl: string;
  bridgeRelativePath: string;
  bundleFileName?: string;
}

export function resolveBridgePath(args: ResolveBridgePathArgs): string {
  const bridgeDir = process.env.BB_BRIDGE_DIR?.trim();
  if (bridgeDir && args.bundleFileName) {
    return resolve(bridgeDir, args.bundleFileName);
  }

  const moduleDir = dirname(fileURLToPath(args.importMetaUrl));
  const sourceCandidate = resolve(moduleDir, args.bridgeRelativePath);
  if (existsSync(sourceCandidate)) {
    return sourceCandidate;
  }

  const packageRoot = resolve(moduleDir, "..", "..");
  const providerDir = basename(moduleDir);
  const distCandidate = resolve(
    packageRoot,
    "dist",
    providerDir,
    args.bridgeRelativePath,
  );
  if (existsSync(distCandidate)) {
    return distCandidate;
  }

  return sourceCandidate;
}
