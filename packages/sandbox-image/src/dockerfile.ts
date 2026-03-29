import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolveSandboxImageDockerfilePath } from "./paths.js";

export function readSandboxImageDockerfile(): string {
  return readFileSync(resolveSandboxImageDockerfilePath(), "utf8");
}

export function getSandboxImageDockerfileHash(): string {
  return createHash("sha256")
    .update(readSandboxImageDockerfile())
    .digest("hex");
}
