import type {
  ViewDelegationMessage,
  ViewMessage,
  ViewUserMessage,
  ViewAssistantTextMessage,
  ViewAssistantReasoningMessage,
  ViewToolCallMessage,
  ViewToolExploringMessage,
  ViewFileEditMessage,
  ViewWebSearchMessage,
  ViewOperationMessage,
  ViewTasksMessage,
  ViewErrorMessage,
} from "@bb/domain";

export type TimelineFormat = "json" | "minimal" | "verbose";

export interface FormatTimelineOptions {
  format: TimelineFormat;
  /** Whether to use ANSI colors. Default: auto-detect from stdout.isTTY. */
  color?: boolean;
}

// Simple ANSI helpers (no external dependency)
function dim(text: string, color: boolean): string {
  return color ? `\x1b[2m${text}\x1b[22m` : text;
}
function cyan(text: string, color: boolean): string {
  return color ? `\x1b[36m${text}\x1b[39m` : text;
}
function green(text: string, color: boolean): string {
  return color ? `\x1b[32m${text}\x1b[39m` : text;
}
function yellow(text: string, color: boolean): string {
  return color ? `\x1b[33m${text}\x1b[39m` : text;
}
function red(text: string, color: boolean): string {
  return color ? `\x1b[31m${text}\x1b[39m` : text;
}

function separator(label: string, color: boolean): string {
  const pad = Math.max(0, 60 - label.length - 4);
  return dim(`── ${label} ${"─".repeat(pad)}`, color);
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 3)}...`;
}

function indentBlock(text: string, prefix: string): string {
  return text
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
}

function statusBadge(status: string, color: boolean): string {
  switch (status) {
    case "completed":
      return green("✓", color);
    case "error":
      return red("✗", color);
    case "pending":
    case "streaming":
      return yellow("⋯", color);
    case "interrupted":
      return yellow("⊘", color);
    default:
      return status;
  }
}

function formatUser(msg: ViewUserMessage, _verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  lines.push(separator("User", color));
  lines.push(msg.text);
  if (msg.attachments) {
    const parts: string[] = [];
    if (msg.attachments.localImages > 0) parts.push(`${msg.attachments.localImages} image(s)`);
    if (msg.attachments.localFiles > 0) parts.push(`${msg.attachments.localFiles} file(s)`);
    if (parts.length > 0) lines.push(dim(`  [${parts.join(", ")}]`, color));
  }
  return lines.join("\n");
}

function formatAssistantText(msg: ViewAssistantTextMessage, _verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  lines.push(separator("Assistant", color));
  lines.push(msg.text);
  return lines.join("\n");
}

function formatReasoning(msg: ViewAssistantReasoningMessage, verbose: boolean, color: boolean): string {
  if (!verbose) return "";
  const lines: string[] = [];
  lines.push(separator("Reasoning", color));
  lines.push(dim(msg.text, color));
  return lines.join("\n");
}

function formatToolCall(msg: ViewToolCallMessage, verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  const badge = statusBadge(msg.status, color);
  const name = msg.toolName ?? "exec_command";
  const cmd = msg.command ?? "";
  lines.push(separator(`Tool Call: ${name}`, color));
  lines.push(`  ${badge} ${cyan(cmd || name, color)}`);
  if (msg.durationMs !== undefined) {
    lines.push(dim(`  ${msg.duration ?? `${msg.durationMs}ms`}`, color));
  }
  if (msg.output) {
    const maxOut = verbose ? 10000 : 200;
    const output = truncate(msg.output.trim(), maxOut);
    if (output) {
      lines.push(dim(`  ${output.split("\n").join("\n  ")}`, color));
    }
  }
  if (msg.exitCode !== undefined && msg.exitCode !== 0) {
    lines.push(red(`  exit code ${msg.exitCode}`, color));
  }
  return lines.join("\n");
}

function formatExploring(msg: ViewToolExploringMessage, verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  const badge = statusBadge(msg.status, color);
  lines.push(separator(`Exploring (${msg.calls.length} call${msg.calls.length === 1 ? "" : "s"})`, color));
  const visibleCalls = verbose ? msg.calls : msg.calls.slice(0, 8);
  for (const call of visibleCalls) {
    const cmd = call.command ?? call.callId;
    lines.push(`  ${badge} ${dim(cmd, color)}`);
    if (verbose && call.output) {
      const output = truncate(call.output.trim(), 500);
      if (output) {
        lines.push(dim(`    ${output.split("\n").join("\n    ")}`, color));
      }
    }
  }
  if (!verbose && msg.calls.length > visibleCalls.length) {
    const remaining = msg.calls.length - visibleCalls.length;
    lines.push(dim(`  ... ${remaining} more exploration call${remaining === 1 ? "" : "s"}`, color));
  }
  return lines.join("\n");
}

function formatFileEdit(msg: ViewFileEditMessage, verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  const badge = statusBadge(msg.status, color);
  lines.push(separator("File Edit", color));
  for (const change of msg.changes) {
    const kindLabel = change.kind ? ` (${change.kind})` : "";
    lines.push(`  ${badge} ${cyan(change.path, color)}${dim(kindLabel, color)}`);
    if (verbose && change.diff) {
      const diff = truncate(change.diff.trim(), 2000);
      lines.push(dim(`  ${diff.split("\n").join("\n  ")}`, color));
    }
  }
  if (msg.stdout && verbose) {
    lines.push(dim(`  ${truncate(msg.stdout.trim(), 500)}`, color));
  }
  return lines.join("\n");
}

function formatWebSearch(msg: ViewWebSearchMessage, _verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  const badge = statusBadge(msg.status, color);
  lines.push(separator("Web Search", color));
  const query = msg.query ?? msg.action ?? "";
  lines.push(`  ${badge} ${cyan(query, color)}`);
  return lines.join("\n");
}

function formatOperation(msg: ViewOperationMessage, _verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  lines.push(separator(`Operation: ${msg.title}`, color));
  if (msg.detail) lines.push(dim(`  ${msg.detail}`, color));
  if (msg.status) lines.push(`  ${statusBadge(msg.status, color)}`);
  return lines.join("\n");
}

function taskStatusGlyph(status: ViewTasksMessage["tasks"][number]["status"]): string {
  switch (status) {
    case "completed":
      return "☒";
    case "active":
      return "◼";
    case "failed":
      return "⚠";
    case "pending":
      return "□";
  }
}

function formatTasks(msg: ViewTasksMessage, _verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  lines.push(separator(msg.title, color));
  for (const task of msg.tasks) {
    lines.push(`  ${taskStatusGlyph(task.status)} ${task.text}`);
  }
  return lines.join("\n");
}

function formatDelegation(msg: ViewDelegationMessage, verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  const badge = statusBadge(msg.status, color);
  const label = msg.command ?? msg.toolName;
  lines.push(separator(`Delegation: ${msg.toolName}`, color));
  lines.push(`  ${badge} ${cyan(label, color)}`);
  if (msg.output) {
    lines.push(dim(`  ${truncate(msg.output.trim(), verbose ? 2000 : 160)}`, color));
  }

  const childBlocks = msg.children
    .map((child) => formatMessage(child, verbose, color))
    .filter((block) => block.length > 0);
  const visibleChildBlocks = verbose ? childBlocks : childBlocks.slice(0, 6);

  for (const block of visibleChildBlocks) {
    lines.push(indentBlock(block, "  "));
  }
  if (!verbose && childBlocks.length > visibleChildBlocks.length) {
    const remaining = childBlocks.length - visibleChildBlocks.length;
    lines.push(dim(`  ... ${remaining} more nested item${remaining === 1 ? "" : "s"}`, color));
  }
  return lines.join("\n");
}

function formatError(msg: ViewErrorMessage, _verbose: boolean, color: boolean): string {
  const lines: string[] = [];
  lines.push(separator("Error", color));
  lines.push(red(`  ${msg.message}`, color));
  return lines.join("\n");
}

function formatMessage(msg: ViewMessage, verbose: boolean, color: boolean): string {
  switch (msg.kind) {
    case "user":
      return formatUser(msg, verbose, color);
    case "assistant-text":
      return formatAssistantText(msg, verbose, color);
    case "assistant-reasoning":
      return formatReasoning(msg, verbose, color);
    case "tool-call":
      return formatToolCall(msg, verbose, color);
    case "tool-exploring":
      return formatExploring(msg, verbose, color);
    case "file-edit":
      return formatFileEdit(msg, verbose, color);
    case "web-search":
      return formatWebSearch(msg, verbose, color);
    case "operation":
      return formatOperation(msg, verbose, color);
    case "tasks":
      return formatTasks(msg, verbose, color);
    case "delegation":
      return formatDelegation(msg, verbose, color);
    case "error":
      return formatError(msg, verbose, color);
    case "debug/raw-event":
      // Skip debug events in timeline view
      return "";
    default:
      return "";
  }
}

/**
 * Format an array of ViewMessages as human-readable terminal text.
 *
 * - `minimal`: Compact view — exploring collapsed, tool output truncated, reasoning hidden
 * - `verbose`: Full view — all output shown, reasoning included, diffs expanded
 */
export function formatTimelineAsText(
  messages: ViewMessage[],
  options?: { verbose?: boolean; color?: boolean },
): string {
  const verbose = options?.verbose ?? false;
  const color = options?.color ?? false;

  const blocks: string[] = [];
  for (const msg of messages) {
    const formatted = formatMessage(msg, verbose, color);
    if (formatted) {
      blocks.push(formatted);
    }
  }
  return blocks.join("\n\n");
}
