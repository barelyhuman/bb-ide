import { createCodexProviderAdapter } from "./codex-provider-adapter.js";
import type { ProviderAdapter, ProviderTitleGenerator } from "./provider-adapter.js";

export interface CreateProviderAdapterOptions {
  providerId?: string;
  codexTitleGenerator?: ProviderTitleGenerator;
}

export function createProviderAdapter(
  opts?: CreateProviderAdapterOptions,
): ProviderAdapter {
  const providerId = (
    opts?.providerId ??
    process.env.BEANBAG_PROVIDER ??
    "codex"
  )
    .trim()
    .toLowerCase();

  switch (providerId) {
    case "codex":
      return createCodexProviderAdapter({
        ...(opts?.codexTitleGenerator
          ? { titleGenerator: opts.codexTitleGenerator }
          : {}),
      });
    default:
      throw new Error(
        `Unsupported provider "${providerId}". Supported providers: codex.`,
      );
  }
}
