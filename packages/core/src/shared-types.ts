export type ReasoningLevel = "low" | "medium" | "high" | "xhigh";

export type SandboxMode =
  | "read-only"
  | "workspace-write"
  | "danger-full-access";

export type TaskStatus = "open" | "in_progress" | "blocked" | "closed";

export type TaskCloseReason = "completed" | "failed" | "canceled";

export type TaskDependencyType = "blocks" | "parent-child" | "related";

export type TaskThreadRole = "primary" | "worker";

export type PromptInput =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };
