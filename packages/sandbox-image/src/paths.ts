import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveSandboxImagePackageRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

export function resolveSandboxImageTemplateRegistryPath(): string {
  return resolve(resolveSandboxImagePackageRoot(), "templates.json");
}

export function resolveSandboxImageDockerfilePath(): string {
  return resolve(resolveSandboxImagePackageRoot(), "Dockerfile");
}
