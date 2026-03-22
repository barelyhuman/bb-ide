import type { ServerRuntimeMode } from "@bb/server-contract";

export function isDevelopmentRuntimeMode(
  runtimeMode: ServerRuntimeMode | undefined,
): boolean {
  return runtimeMode === "development";
}
