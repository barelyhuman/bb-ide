import { resolve } from "node:path";

interface ResolveBridgePathOptions {
  bundleFileName: string;
  moduleDirname: string;
}

function resolveCompiledModuleDir(moduleDirname: string): string {
  return moduleDirname.includes("/src/")
    ? moduleDirname.replace("/src/", "/dist/")
    : moduleDirname;
}

export function resolveBridgePath(options: ResolveBridgePathOptions): string {
  const bridgeDir = process.env.BB_BRIDGE_DIR?.trim();
  if (bridgeDir) {
    return resolve(bridgeDir, options.bundleFileName);
  }

  return resolve(
    resolveCompiledModuleDir(options.moduleDirname),
    "bridge",
    "bridge.js",
  );
}
