import { assertNever } from "@beanbag/agent-core";

export type E2eProviderMode = "fake" | "real";

export function resolveE2eProviderMode(): E2eProviderMode {
  const rawMode = (process.env.BEANBAG_E2E_PROVIDER_MODE ?? "fake")
    .trim()
    .toLowerCase();

  switch (rawMode) {
    case "fake":
      return "fake";
    case "real":
      return "real";
    default:
      throw new Error(
        `Unsupported BEANBAG_E2E_PROVIDER_MODE "${rawMode}". Expected one of: fake, real.`,
      );
  }
}

export function e2eTimeoutMs(fakeMs: number, realMs: number): number {
  const providerMode = resolveE2eProviderMode();
  switch (providerMode) {
    case "fake":
      return fakeMs;
    case "real":
      return realMs;
    default:
      return assertNever(providerMode);
  }
}

export function supportsFakeCodexControl(): boolean {
  return resolveE2eProviderMode() === "fake";
}
