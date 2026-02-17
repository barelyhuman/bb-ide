function normalizeValue(value?: string): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

export function resolveProjectId(flagValue?: string): string | undefined {
  return normalizeValue(flagValue) ?? normalizeValue(process.env.BB_PROJECT_ID);
}

export function resolveTaskId(flagValue?: string): string | undefined {
  return normalizeValue(flagValue) ?? normalizeValue(process.env.BB_TASK_ID);
}

export function resolveThreadId(flagValue?: string): string | undefined {
  return normalizeValue(flagValue) ?? normalizeValue(process.env.BB_THREAD_ID);
}

export function requireProjectId(flagValue?: string): string {
  const projectId = resolveProjectId(flagValue);
  if (projectId) return projectId;
  throw new Error("Missing project context. Pass --project <id> or set BB_PROJECT_ID.");
}
