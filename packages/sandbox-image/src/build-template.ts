import { writeFile } from "node:fs/promises";
import {
  Template,
  defaultBuildLogger,
} from "e2b";
import {
  SANDBOX_IMAGE_BUILD_CPU_COUNT,
  SANDBOX_IMAGE_BUILD_MEMORY_MB,
  SANDBOX_IMAGE_BUILD_TAGS,
  SANDBOX_IMAGE_NAME,
} from "./constants.js";
import { getSandboxImageDockerfileHash } from "./dockerfile.js";
import { resolveSandboxImageTemplateRegistryPath } from "./paths.js";
import { createSandboxImageTemplate } from "./template.js";
import type { SandboxImageTemplateRegistry } from "./types.js";

async function main(): Promise<void> {
  const buildInfo = await Template.build(
    createSandboxImageTemplate(),
    SANDBOX_IMAGE_NAME,
    {
      cpuCount: SANDBOX_IMAGE_BUILD_CPU_COUNT,
      memoryMB: SANDBOX_IMAGE_BUILD_MEMORY_MB,
      onBuildLogs: defaultBuildLogger(),
      tags: [...SANDBOX_IMAGE_BUILD_TAGS],
    },
  );

  const registry: SandboxImageTemplateRegistry = {
    current: {
      buildId: buildInfo.buildId,
      builtAt: new Date().toISOString(),
      createTarget: `${buildInfo.name}:${buildInfo.buildId}`,
      dockerfileHash: getSandboxImageDockerfileHash(),
      name: buildInfo.name,
      tags: buildInfo.tags,
      templateId: buildInfo.templateId,
    },
  };

  await writeFile(
    resolveSandboxImageTemplateRegistryPath(),
    JSON.stringify(registry, null, 2) + "\n",
    "utf8",
  );

  console.log(`Built template ${buildInfo.templateId}`);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
