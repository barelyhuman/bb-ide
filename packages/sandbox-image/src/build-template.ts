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
import { createSandboxImageTemplate } from "./template.js";

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

  console.log(`Built template ${buildInfo.templateId}`);
  console.log(`Export E2B_TEMPLATE=${buildInfo.name}:${buildInfo.buildId}`);
}

void main().catch((error) => {
  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
