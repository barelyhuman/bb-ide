import { fileURLToPath } from "node:url";

export function resolveSandboxImageDockerfilePath(): string {
  return fileURLToPath(new URL("../Dockerfile", import.meta.url));
}
