import type { ThreadProvisionContext } from "./thread-provisioning-context.js";

interface ActiveThreadProvisionContextEntry {
  context: ThreadProvisionContext;
  threadId: string;
}

const activeThreadProvisionContexts = new Map<
  string,
  ActiveThreadProvisionContextEntry
>();

export function rememberActiveThreadProvisionContext(
  entry: ActiveThreadProvisionContextEntry,
): void {
  activeThreadProvisionContexts.set(entry.threadId, entry);
}

export function forgetActiveThreadProvisionContext(threadId: string): void {
  activeThreadProvisionContexts.delete(threadId);
}

export function getActiveThreadProvisionContext(
  threadId: string,
): ThreadProvisionContext | null {
  return activeThreadProvisionContexts.get(threadId)?.context ?? null;
}
