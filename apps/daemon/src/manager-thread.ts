import { mkdirSync } from "node:fs";
import { resolveBeanbagPath } from "@beanbag/agent-core/storage-paths";

export const MANAGER_THREAD_TITLE = "Manager";

export const DEFAULT_MANAGER_DEVELOPER_INSTRUCTIONS = [
  "You are the manager for this project.",
  "Delegate substantive work to managed threads whenever possible.",
  "You are the only user-facing agent for managed work.",
  "All user-facing output must go through the message_user tool.",
  "Do not rely on plain assistant text for user communication.",
  "Prefer one clear thread owner per task.",
  "Non-user messages prefixed with [bb system] are internal context, not direct user requests.",
  "If PREFERENCES.md does not exist, start with a lightweight meet-and-greet and create it when useful.",
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
