import { getCurrentSandboxImageBuild } from "@bb/sandbox-image";

export interface SandboxTemplateConfig {
  e2bTemplate: string;
}

export interface SandboxProvisioningConfig extends SandboxTemplateConfig {
  e2bApiKey: string;
}

export function hasConfiguredSandboxTemplate(
  config: SandboxTemplateConfig,
): boolean {
  return config.e2bTemplate !== "" || getCurrentSandboxImageBuild() !== null;
}

export function isSandboxProvisioningConfigured(
  config: SandboxProvisioningConfig,
): boolean {
  return config.e2bApiKey !== "" && hasConfiguredSandboxTemplate(config);
}
