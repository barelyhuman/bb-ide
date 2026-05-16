import { z } from "zod";
import type { ProviderCapabilities, ProviderInfo } from "@bb/domain";

const AGENT_PROVIDER_ID_VALUES = ["codex", "claude-code", "pi"] as const;
export const agentProviderIdSchema = z.enum(AGENT_PROVIDER_ID_VALUES);
export type AgentProviderId = z.infer<typeof agentProviderIdSchema>;

export interface BuiltInAgentProviderInfo extends ProviderInfo {
  id: AgentProviderId;
}

export interface BuiltInAgentProviderCatalogEntry {
  info: BuiltInAgentProviderInfo;
}

type PiDefaultModelPerProvider = Partial<Record<string, string>>;

const CODEX_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: true,
  supportsRename: true,
  supportsServiceTier: true,
  supportsUserQuestion: false,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const CLAUDE_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: true,
  supportedPermissionModes: ["full", "workspace-write", "readonly"],
};

const PI_CAPABILITIES: ProviderCapabilities = {
  supportsArchive: false,
  supportsRename: false,
  supportsServiceTier: false,
  supportsUserQuestion: false,
  supportedPermissionModes: ["full"],
};

const BUILT_IN_AGENT_PROVIDER_CATALOG: BuiltInAgentProviderCatalogEntry[] = [
  {
    info: {
      available: true,
      capabilities: CODEX_CAPABILITIES,
      displayName: "Codex",
      id: "codex",
    },
  },
  {
    info: {
      available: true,
      capabilities: CLAUDE_CAPABILITIES,
      displayName: "Claude Code",
      id: "claude-code",
    },
  },
  {
    info: {
      available: true,
      capabilities: PI_CAPABILITIES,
      displayName: "Pi",
      id: "pi",
    },
  },
];

const builtInAgentProviderById = new Map(
  BUILT_IN_AGENT_PROVIDER_CATALOG.map((provider) => [
    provider.info.id,
    provider,
  ]),
);

/**
 * Best default model per provider. Subset of pi-mono's `defaultModelPerProvider`:
 * https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/src/core/model-resolver.ts
 */
export const PI_DEFAULT_MODEL_PER_PROVIDER: PiDefaultModelPerProvider = {
  anthropic: "claude-opus-4-7",
  openai: "gpt-5.4",
  "openai-codex": "gpt-5.5",
  "amazon-bedrock": "us.anthropic.claude-opus-4-7",
  google: "gemini-2.5-pro",
  "google-gemini-cli": "gemini-2.5-pro",
  "google-vertex": "gemini-3-pro-preview",
  openrouter: "openai/gpt-5.1-codex",
  "vercel-ai-gateway": "anthropic/claude-opus-4.7",
  xai: "grok-4-fast-non-reasoning",
  mistral: "devstral-medium-latest",
};

function cloneCapabilities(
  capabilities: ProviderCapabilities,
): ProviderCapabilities {
  return {
    supportsArchive: capabilities.supportsArchive,
    supportsRename: capabilities.supportsRename,
    supportsServiceTier: capabilities.supportsServiceTier,
    supportsUserQuestion: capabilities.supportsUserQuestion,
    supportedPermissionModes: [...capabilities.supportedPermissionModes],
  };
}

function cloneBuiltInAgentProviderInfo(
  info: BuiltInAgentProviderInfo,
): BuiltInAgentProviderInfo {
  return {
    available: info.available,
    capabilities: cloneCapabilities(info.capabilities),
    displayName: info.displayName,
    id: info.id,
  };
}

export function isAgentProviderId(value: string): value is AgentProviderId {
  return agentProviderIdSchema.safeParse(value).success;
}

export function listBuiltInAgentProviderInfos(): BuiltInAgentProviderInfo[] {
  return BUILT_IN_AGENT_PROVIDER_CATALOG.map((provider) =>
    cloneBuiltInAgentProviderInfo(provider.info),
  );
}

export function getBuiltInAgentProviderInfo(
  providerId: AgentProviderId,
): BuiltInAgentProviderInfo {
  const provider = builtInAgentProviderById.get(providerId);
  if (!provider) {
    throw new Error(`Unsupported agent provider "${providerId}".`);
  }
  return cloneBuiltInAgentProviderInfo(provider.info);
}

export function resolvePiDefaultModelId(
  providerId: string,
): string | undefined {
  return PI_DEFAULT_MODEL_PER_PROVIDER[providerId];
}
