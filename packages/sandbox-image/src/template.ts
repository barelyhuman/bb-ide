import { Template } from "e2b";
import { resolveSandboxImageDockerfilePath } from "./paths.js";

export function createSandboxImageTemplate() {
  return Template().fromDockerfile(resolveSandboxImageDockerfilePath());
}
