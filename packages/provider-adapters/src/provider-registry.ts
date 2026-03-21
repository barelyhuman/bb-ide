/**
 * Provider registry.
 *
 * Manages the set of available provider adapters. Built-in providers (codex,
 * claude-code, pi) are registered at import time. Extension providers can be
 * added via `registerProvider()` at runtime.
 */

import {
  DEFAULT_THREAD_PROVIDER_ID,
  type SystemProviderInfo,
} from "@bb/core";
import { createClaudeCodeProviderAdapter } from "./claude-code-provider-adapter.js";
import { createCodexProviderAdapter } from "./codex-provider-adapter.js";
import { createPiProviderAdapter } from "./pi-provider-adapter.js";
import type { ProviderAdapter } from "./provider-adapter.js";

// ---------------------------------------------------------------------------
// Registry state
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ProviderFactory = () => ProviderAdapter<any, any>;

const builtInFactories = new Map<string, ProviderFactory>([
  ["codex", createCodexProviderAdapter],
  ["claude-code", createClaudeCodeProviderAdapter],
  ["pi", createPiProviderAdapter],
]);

const extensionFactories = new Map<string, ProviderFactory>();

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

/**
 * Register a custom provider adapter.
 *
 * Extension providers are available alongside built-in providers. If a
 * provider with the same ID is already registered (built-in or extension),
 * the registration is rejected with an error.
 */
export function registerProvider(
  id: string,
  factory: ProviderFactory,
): void {
  if (builtInFactories.has(id)) {
    throw new Error(
      `Cannot register provider "${id}" — it conflicts with a built-in provider.`,
    );
  }
  if (extensionFactories.has(id)) {
    throw new Error(
      `Cannot register provider "${id}" — an extension provider with this ID is already registered.`,
    );
  }
  extensionFactories.set(id, factory);
}

/**
 * Unregister a previously registered extension provider.
 * Built-in providers cannot be unregistered.
 */
export function unregisterProvider(id: string): boolean {
  return extensionFactories.delete(id);
}

/**
 * Clear all extension provider registrations.
 * Useful for testing.
 */
export function clearExtensionProviders(): void {
  extensionFactories.clear();
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export interface CreateProviderAdapterOptions {
  providerId?: string;
}

/**
 * Create a provider adapter by ID.
 *
 * Looks up built-in providers first, then extension providers.
 * Throws if the ID is not found.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createProviderForId(providerId: string): ProviderAdapter<any, any> {
  const factory =
    builtInFactories.get(providerId) ??
    extensionFactories.get(providerId);

  if (!factory) {
    const allIds = [...builtInFactories.keys(), ...extensionFactories.keys()];
    throw new Error(
      `Unsupported provider "${providerId}". Available providers: ${allIds.join(", ")}.`,
    );
  }

  return factory();
}

/**
 * List info for all available providers (built-in + extension).
 */
export function listAvailableProviderInfos(): SystemProviderInfo[] {
  const infos: SystemProviderInfo[] = [];

  for (const [id] of builtInFactories) {
    const provider = createProviderForId(id);
    infos.push({
      id: provider.id,
      displayName: provider.displayName,
      capabilities: { ...provider.capabilities },
    });
  }

  for (const [id] of extensionFactories) {
    const provider = createProviderForId(id);
    infos.push({
      id: provider.id,
      displayName: provider.displayName,
      capabilities: { ...provider.capabilities },
    });
  }

  return infos;
}

/**
 * Resolve the default provider ID from environment variables.
 *
 * Checks `BB_DEFAULT_PROVIDER`, then `BB_E2E_PROVIDER`, then falls back
 * to the compile-time default (codex).
 *
 * Accepts both built-in and extension provider IDs.
 */
export function resolveDefaultProviderId(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredDefault = env.BB_DEFAULT_PROVIDER?.trim().toLowerCase();
  if (configuredDefault && isKnownProviderId(configuredDefault)) {
    return configuredDefault;
  }

  const testOverride = env.BB_E2E_PROVIDER?.trim().toLowerCase();
  if (testOverride && isKnownProviderId(testOverride)) {
    return testOverride;
  }

  return DEFAULT_THREAD_PROVIDER_ID;
}

/**
 * Create a provider adapter, using the default provider if no ID is specified.
 */
export function createProviderAdapter(
  opts?: CreateProviderAdapterOptions,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): ProviderAdapter<any, any> {
  const providerId = (opts?.providerId ?? resolveDefaultProviderId())
    .trim()
    .toLowerCase();

  return createProviderForId(providerId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isKnownProviderId(id: string): boolean {
  return builtInFactories.has(id) || extensionFactories.has(id);
}
