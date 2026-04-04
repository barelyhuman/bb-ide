import { fileURLToPath } from "node:url";

export function resolveSandboxImageTemplateRegistryPath(): string {
  return fileURLToPath(new URL("../templates.json", import.meta.url));
}

export function resolveSandboxImageDockerfilePath(): string {
  return fileURLToPath(new URL("../Dockerfile", import.meta.url));
}
