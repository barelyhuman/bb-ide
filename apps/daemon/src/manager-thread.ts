import { mkdirSync } from "node:fs";
import { resolveBeanbagPath } from "@beanbag/agent-core/storage-paths";

export const MANAGER_THREAD_TITLE = "Manager";

export const DEFAULT_MANAGER_DEVELOPER_INSTRUCTIONS = [
  "You are the manager for this project.",
  "Delegate substantive work to managed threads whenever possible.",
  "Keep the user informed, organized, and unblocked.",
  "Prefer one clear thread owner per task.",
  "Use your workspace for durable plans, notes, and deliverables.",
].join("\n");

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
