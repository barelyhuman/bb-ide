import type { SystemProviderInfo } from "@beanbag/agent-core";
import { createClaudeCodeProviderAdapter } from "./claude-provider-adapter.js";
import { createCodexProviderAdapter } from "./codex-provider-adapter.js";
import { createPiMonoProviderAdapter } from "./pi-provider-adapter.js";
import type {
  ProviderAdapter,
  ProviderCommitMessageGenerator,
  ProviderTitleGenerator,
} from "./provider-adapter.js";

export interface CreateProviderAdapterOptions {
  providerId?: string;
  codexTitleGenerator?: ProviderTitleGenerator;
  codexCommitMessageGenerator?: ProviderCommitMessageGenerator;
}

const SUPPORTED_PROVIDER_IDS = ["codex", "pi-mono", "claude-code"] as const;
type SupportedProviderId = (typeof SUPPORTED_PROVIDER_IDS)[number];

function createProviderForId(
  providerId: SupportedProviderId,
  titleGenerator?: ProviderTitleGenerator,
  commitMessageGenerator?: ProviderCommitMessageGenerator,
): ProviderAdapter {
  switch (providerId) {
    case "codex":
      return createCodexProviderAdapter({
        ...(titleGenerator ? { titleGenerator } : {}),
        ...(commitMessageGenerator ? { commitMessageGenerator } : {}),
      });
    case "pi-mono":
      return createPiMonoProviderAdapter({
        ...(titleGenerator ? { titleGenerator } : {}),
        ...(commitMessageGenerator ? { commitMessageGenerator } : {}),
      });
    case "claude-code":
      return createClaudeCodeProviderAdapter({
        ...(titleGenerator ? { titleGenerator } : {}),
        ...(commitMessageGenerator ? { commitMessageGenerator } : {}),
      });
    default:
      throw new Error(`Unsupported provider "${providerId}"`);
  }
}

export function listAvailableProviderInfos(
  opts?: Pick<CreateProviderAdapterOptions, "codexTitleGenerator" | "codexCommitMessageGenerator">,
): SystemProviderInfo[] {
  return SUPPORTED_PROVIDER_IDS.map((providerId) => {
    const provider = createProviderForId(
      providerId,
      opts?.codexTitleGenerator,
      opts?.codexCommitMessageGenerator,
    );
    return {
      id: provider.id,
      displayName: provider.displayName,
      capabilities: { ...provider.capabilities },
    };
  });
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

  if (!SUPPORTED_PROVIDER_IDS.includes(providerId as SupportedProviderId)) {
    throw new Error(
      `Unsupported provider "${providerId}". Supported providers: ${SUPPORTED_PROVIDER_IDS.join(", ")}.`,
    );
  }

  return createProviderForId(
    providerId as SupportedProviderId,
    opts?.codexTitleGenerator,
    opts?.codexCommitMessageGenerator,
  );
}
