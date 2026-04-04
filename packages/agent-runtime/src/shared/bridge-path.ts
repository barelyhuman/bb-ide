import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface ResolveBridgePathArgs {
  importMetaUrl: string;
  bridgeRelativePath: string;
  bridgeBundleDir?: string;
  bundleFileName?: string;
}

export function resolveBridgePath(args: ResolveBridgePathArgs): string {
  if (args.bridgeBundleDir && args.bundleFileName) {
    return resolve(args.bridgeBundleDir, args.bundleFileName);
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
