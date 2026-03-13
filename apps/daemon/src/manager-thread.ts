import { mkdirSync } from "node:fs";
import { resolveBeanbagPath } from "@beanbag/agent-core/storage-paths";
import { renderTemplate } from "@beanbag/templates";

export const MANAGER_THREAD_TITLE = "Manager";

export const DEFAULT_MANAGER_DEVELOPER_INSTRUCTIONS = renderTemplate(
  "managerAgentInstructions",
  {},
);

export const MANAGER_WELCOME_MESSAGE = "[bb system] Welcome!";

export function resolveManagerWorkspacePath(
  runtimeEnv: NodeJS.ProcessEnv,
  threadId: string,
): string {
  return resolveBeanbagPath(runtimeEnv, "workspace", threadId);
}

export function ensureManagerWorkspace(
  runtimeEnv: NodeJS.ProcessEnv,
  threadId: string,
): string {
  const workspacePath = resolveManagerWorkspacePath(runtimeEnv, threadId);
  mkdirSync(workspacePath, { recursive: true });
  return workspacePath;
}
