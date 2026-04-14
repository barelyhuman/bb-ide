import type { ExternalServerUrlConfig } from "./external-server-url.js";
import { hasConfiguredReachableExternalServerUrl } from "./external-server-url.js";

export interface SandboxTemplateConfig {
  e2bTemplate: string;
}

export interface SandboxProvisioningConfig
  extends SandboxTemplateConfig,
    ExternalServerUrlConfig {
  e2bApiKey: string;
}

export function hasConfiguredSandboxTemplate(
  config: SandboxTemplateConfig,
): boolean {
  return config.e2bTemplate !== "";
}

export function isSandboxProvisioningConfigured(
  config: SandboxProvisioningConfig,
): boolean {
  return (
    config.e2bApiKey !== "" &&
    hasConfiguredSandboxTemplate(config) &&
    hasConfiguredReachableExternalServerUrl(config)
  );
}
