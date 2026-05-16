export type EnvironmentHostMode = "local" | "worktree";

export interface ParsedHostEnvironmentValue {
  type: "host";
  hostId: string;
  mode: EnvironmentHostMode;
}

export type ParsedEnvironmentValue = ParsedHostEnvironmentValue | null;

export function encodeHostValue(
  hostId: string,
  mode: EnvironmentHostMode,
): string {
  return `host:${hostId}:${mode}`;
}

export function parseEnvironmentValue(value: string): ParsedEnvironmentValue {
  if (value.startsWith("host:")) {
    const parts = value.split(":");
    const hostId = parts[1];
    const mode = parts[2];
    if (hostId && (mode === "local" || mode === "worktree")) {
      return { type: "host", hostId, mode };
    }
  }
  return null;
}
