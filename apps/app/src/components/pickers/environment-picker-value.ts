export type EnvironmentHostMode = "local" | "worktree";

export interface ParsedHostEnvironmentValue {
  type: "host";
  hostId: string;
  mode: EnvironmentHostMode;
}

export interface ParsedSandboxEnvironmentValue {
  type: "sandbox";
  backendId: string;
}

export type ParsedEnvironmentValue =
  | ParsedHostEnvironmentValue
  | ParsedSandboxEnvironmentValue
  | null;

export function encodeHostValue(
  hostId: string,
  mode: EnvironmentHostMode,
): string {
  return `host:${hostId}:${mode}`;
}

export function encodeSandboxValue(backendId: string): string {
  return `sandbox:${backendId}`;
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
  if (value.startsWith("sandbox:")) {
    const backendId = value.slice("sandbox:".length);
    if (backendId) {
      return { type: "sandbox", backendId };
    }
  }
  return null;
}
