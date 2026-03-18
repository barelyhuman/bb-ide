import type { ServerRuntimeMode } from "@bb/core";

export function isDevelopmentRuntimeMode(
  runtimeMode: ServerRuntimeMode | undefined,
): boolean {
  return runtimeMode === "development";
}
