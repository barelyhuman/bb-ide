import type { ViewToolCallSummary, ViewToolParsedIntent } from "@bb/domain";
import { getFirstStringField } from "./format-helpers.js";

const SHELL_WRAPPER_NAMES = new Set(["sh", "bash", "zsh"]);

type ToolArguments = Record<string, unknown>;

type ToolCommandFormatter = (toolName: string, args: ToolArguments) => string;

type ToolOutputFormatter = (output: string) => string;

interface TodoWriteTodo {
  content?: string;
  status?: string;
  activeForm?: string;
}

interface ShellReadPattern {
  pattern: RegExp;
  captureIndex: number;
}

function unwrapQuotedShellArg(value: string): string {
  if (value.length < 2) return value;
  const quote = value[0];
  if ((quote !== "'" && quote !== '"') || value[value.length - 1] !== quote) {
    return value;
  }
  return value.slice(1, -1);
}

function isKnownShellWrapper(value: string): boolean {
  const shellName = value.split("/").pop() ?? value;
  // Shell wrapper names are open_external runtime values; unknown shells intentionally
  // preserve the original command payload for display.
  return SHELL_WRAPPER_NAMES.has(shellName);
}

export function extractShellCommandFromString(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  const match = /^(\S+)\s+(-lc|-c)\s+([\s\S]+)$/.exec(trimmed);
  if (!match) return trimmed;

  const shellProgram = match[1];
  const commandArg = match[3];
  if (!shellProgram || !commandArg || !isKnownShellWrapper(shellProgram)) {
    return trimmed;
  }

  return unwrapQuotedShellArg(commandArg.trim());
}

// ── Tool descriptor table ──────────────────────────────────────────────
// Each entry defines how to parse intent and format display for a known tool.
// To add a new tool, add one row — both toolNameToParsedIntents and
// formatToolCallCommand will pick it up automatically.

interface ToolDescriptor {
  /** The exploring-intent type, or null if this tool is not an exploring action. */
  intentType: ViewToolParsedIntent["type"] | null;
  /** Arg keys to extract as the primary value (tried in order). */
  argKeys: readonly string[];
  /** Optional secondary arg keys (e.g. path for Grep). */
  secondaryArgKeys?: readonly string[];
  /** Optional custom command formatter for non-standard tools. */
  formatCommand?: ToolCommandFormatter;
  /** Optional output formatter for non-standard tools. */
  formatOutput?: ToolOutputFormatter;
}

const TOOL_TABLE: Record<string, ToolDescriptor> = {
  Read:  { intentType: "read",       argKeys: ["file_path", "file", "path"] },
  read:  { intentType: "read",       argKeys: ["file_path", "file", "path"] },
  Glob:  { intentType: "list_files", argKeys: ["pattern", "path"] },
  glob:  { intentType: "list_files", argKeys: ["pattern", "path"] },
  ls:    { intentType: "list_files", argKeys: ["pattern", "path"] },
  find:  { intentType: "list_files", argKeys: ["pattern", "path"] },
  Grep:  { intentType: "search",     argKeys: ["pattern", "query"], secondaryArgKeys: ["path"] },
  grep:  { intentType: "search",     argKeys: ["pattern", "query"], secondaryArgKeys: ["path"] },
  Bash:  { intentType: null,         argKeys: ["command"] },
  bash:  { intentType: null,         argKeys: ["command"] },
  Edit:  { intentType: null,         argKeys: ["file_path", "path"] },
  edit:  { intentType: null,         argKeys: ["file_path", "path"] },
  Write: { intentType: null,         argKeys: ["file_path", "path"] },
  write: { intentType: null,         argKeys: ["file_path", "path"] },
  ToolSearch: { intentType: null,    argKeys: ["query"], formatCommand: formatToolSearchCommand },
  TodoWrite: { intentType: null,     argKeys: [], formatCommand: formatTodoWriteCommand, formatOutput: formatTodoWriteOutput },
  Agent: { intentType: null,         argKeys: ["description", "prompt"], formatCommand: formatAgentCommand, formatOutput: formatAgentOutput },
  spawnAgent: { intentType: null,    argKeys: ["prompt"], formatCommand: formatCollabAgentCommand },
  sendInput: { intentType: null,     argKeys: ["prompt"], formatCommand: formatCollabAgentCommand },
  resumeAgent: { intentType: null,   argKeys: [], formatCommand: formatCollabAgentCommand },
  wait: { intentType: null,          argKeys: [], formatCommand: formatCollabAgentCommand },
  closeAgent: { intentType: null,    argKeys: [], formatCommand: formatCollabAgentCommand },
};

function truncateForDisplay(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 3)}...`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function asTodoWriteTodos(value: unknown): TodoWriteTodo[] {
  if (!Array.isArray(value)) return [];

  const todos: TodoWriteTodo[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    todos.push({
      content: asString(entry.content),
      status: asString(entry.status),
      activeForm: asString(entry.activeForm),
    });
  }
  return todos;
}

function summarizeTodoCounts(todos: TodoWriteTodo[]): string {
  let pending = 0;
  let inProgress = 0;
  let completed = 0;

  for (const todo of todos) {
    switch (todo.status) {
      case "in_progress":
        inProgress += 1;
        break;
      case "completed":
        completed += 1;
        break;
      default:
        pending += 1;
        break;
    }
  }

  const parts: string[] = [];
  if (inProgress > 0) parts.push(`${inProgress} in progress`);
  if (pending > 0) parts.push(`${pending} pending`);
  if (completed > 0) parts.push(`${completed} completed`);
  return parts.join(", ");
}

function formatTodoWriteCommand(_toolName: string, args: ToolArguments): string {
  const todos = asTodoWriteTodos(args.todos);
  if (todos.length === 0) return "TodoWrite";

  const activeTodo = todos.find((todo) => todo.status === "in_progress");
  const headline = activeTodo?.activeForm ?? activeTodo?.content ?? todos[0]?.content;
  const countSummary = summarizeTodoCounts(todos);
  const summaryParts = [`${todos.length} todo${todos.length === 1 ? "" : "s"}`];

  if (countSummary.length > 0) {
    summaryParts.push(countSummary);
  }

  const header = `TodoWrite ${summaryParts.join(" - ")}`;
  if (!headline) return header;
  return `${header}: ${truncateForDisplay(headline, 80)}`;
}

function formatTodoWriteOutput(output: string): string {
  if (output.startsWith("Todos have been modified successfully.")) {
    return "Todo list updated";
  }
  return output;
}

function formatToolSearchCommand(_toolName: string, args: ToolArguments): string {
  const query = getFirstStringField(args, ["query"]);
  if (!query) return "ToolSearch";
  return `ToolSearch ${query}`;
}

function formatAgentCommand(_toolName: string, args: ToolArguments): string {
  const description = getFirstStringField(args, ["description"]);
  const prompt = getFirstStringField(args, ["prompt"]);
  const subagentType = getFirstStringField(args, ["subagent_type"]);
  const label = description ?? prompt;
  if (!label && !subagentType) return "Agent";
  if (!subagentType) return `Agent ${truncateForDisplay(label ?? "", 90)}`.trim();
  if (!label) return `Agent [${subagentType}]`;
  return `Agent [${subagentType}] ${truncateForDisplay(label, 90)}`;
}

function stripAgentOutputMetadata(output: string): string {
  const lines = output
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => !line.startsWith("agentId:") && !line.startsWith("<usage>"));
  return lines.join("\n").trim();
}

function extractMarkdownHeading(output: string): string | undefined {
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    const match = /^(#{1,6})\s+(.+)$/u.exec(trimmed);
    if (!match) continue;
    return match[2]?.trim();
  }
  return undefined;
}

function firstParagraph(output: string): string | undefined {
  for (const paragraph of output.split(/\n\s*\n/u)) {
    const trimmed = paragraph.replace(/\s+/gu, " ").trim();
    if (trimmed.length > 0) {
      return trimmed;
    }
  }
  return undefined;
}

function formatAgentOutput(output: string): string {
  const cleaned = stripAgentOutputMetadata(output);
  if (cleaned.length === 0) return "Subagent completed";

  const heading = extractMarkdownHeading(cleaned);
  if (heading) {
    return `Subagent report: ${truncateForDisplay(heading, 120)}`;
  }

  const paragraph = firstParagraph(cleaned);
  if (!paragraph) return "Subagent completed";
  return `Subagent result: ${truncateForDisplay(paragraph, 120)}`;
}

function countReceiverThreadIds(args: ToolArguments): number {
  const receiverThreadIds = args["receiverThreadIds"];
  return Array.isArray(receiverThreadIds) ? receiverThreadIds.length : 0;
}

function formatCollabAgentCommand(toolName: string, args: ToolArguments): string {
  const receiverCount = countReceiverThreadIds(args);
  const prompt = getFirstStringField(args, ["prompt"]);

  if (toolName === "wait") {
    return receiverCount > 0
      ? `wait for ${receiverCount} agent${receiverCount === 1 ? "" : "s"}`
      : "wait";
  }

  if (toolName === "resumeAgent") {
    return receiverCount > 0
      ? `resumeAgent ${receiverCount} agent${receiverCount === 1 ? "" : "s"}`
      : "resumeAgent";
  }

  if (toolName === "closeAgent") {
    return receiverCount > 0
      ? `closeAgent ${receiverCount} agent${receiverCount === 1 ? "" : "s"}`
      : "closeAgent";
  }

  const action = receiverCount > 0
    ? `${toolName} ${receiverCount} agent${receiverCount === 1 ? "" : "s"}`
    : toolName;
  if (!prompt) return action;
  return `${action}: ${truncateForDisplay(prompt, 90)}`;
}

const SHELL_READ_PATTERNS: readonly ShellReadPattern[] = [
  {
    pattern: /\bsed\s+-n\s+(?:"[^"]*"|'[^']*'|\S+)\s+([^\s|&;]+)/u,
    captureIndex: 1,
  },
  {
    pattern: /\bnl\s+-ba\s+([^\s|&;]+)/u,
    captureIndex: 1,
  },
  {
    pattern: /\bcat\s+([^\s|&;]+)/u,
    captureIndex: 1,
  },
  {
    pattern: /\bhead(?:\s+-\d+)?\s+([^\s|&;]+)/u,
    captureIndex: 1,
  },
];

function extractShellReadPath(command: string): string | null {
  for (const entry of SHELL_READ_PATTERNS) {
    const match = entry.pattern.exec(command);
    const path = match?.[entry.captureIndex]?.trim();
    if (path) return path;
  }
  return null;
}

function extractFindPath(command: string): string | null {
  const match = /\bfind\s+([^\s|&;]+)/u.exec(command);
  return match?.[1]?.trim() ?? null;
}

function extractLsPath(command: string): string | null {
  const match = /\bls\b(?:\s+-[^\s]+)*\s+([^\s|&;]+)/u.exec(command);
  return match?.[1]?.trim() ?? null;
}

function extractSearchQuery(command: string): string | null {
  const quoted = /\b(?:rg|grep)\b[\s\S]*?(?:"([^"]+)"|'([^']+)')/u.exec(command);
  if (quoted?.[1]) return quoted[1].trim();
  if (quoted?.[2]) return quoted[2].trim();

  const unquoted = /\b(?:rg|grep)\b(?:\s+-[^\s]+|\s+--[^\s]+)*\s+([^\s|&;]+)/u.exec(command);
  return unquoted?.[1]?.trim() ?? null;
}

export function parseShellCommandIntents(command: string | undefined): ViewToolParsedIntent[] {
  if (!command) return [];

  if (/\brg\b/u.test(command)) {
    return [
      {
        type: "search",
        cmd: command,
        query: extractSearchQuery(command),
        path: null,
      },
    ];
  }

  const readPath = extractShellReadPath(command);
  if (readPath) {
    return [
      {
        type: "read",
        cmd: command,
        name: "exec_command",
        path: readPath,
      },
    ];
  }

  const findPath = extractFindPath(command);
  if (findPath) {
    return [
      {
        type: "list_files",
        cmd: command,
        path: findPath,
      },
    ];
  }

  const lsPath = extractLsPath(command);
  if (lsPath) {
    return [
      {
        type: "list_files",
        cmd: command,
        path: lsPath,
      },
    ];
  }

  if (/\bgrep\b/u.test(command)) {
    return [
      {
        type: "search",
        cmd: command,
        query: extractSearchQuery(command),
        path: null,
      },
    ];
  }

  return [];
}

// Maps well-known tool names to exploring intents for grouping
export function toolNameToParsedIntents(
  toolName: string,
  args: Record<string, unknown> | null,
): ViewToolParsedIntent[] {
  if (toolName === "exec_command" || toolName === "Bash" || toolName === "bash") {
    const command = getFirstStringField(args, ["command", "cmd"]);
    return parseShellCommandIntents(command);
  }

  const desc = TOOL_TABLE[toolName];
  if (!desc?.intentType) return [];

  const primary = getFirstStringField(args, desc.argKeys) ?? "";
  const secondary = desc.secondaryArgKeys
    ? getFirstStringField(args, desc.secondaryArgKeys) ?? ""
    : "";

  switch (desc.intentType) {
    case "read":
      return [{ type: "read", cmd: `${toolName} ${primary}`.trim(), name: toolName, path: primary || null }];
    case "list_files":
      return [{ type: "list_files", cmd: `${toolName} ${primary}`.trim(), path: primary || null }];
    case "search":
      return [{ type: "search", cmd: `${toolName} '${primary}'${secondary ? ` in ${secondary}` : ""}`.trim(), query: primary || null, path: secondary || null }];
    default:
      return [];
  }
}

export function formatToolCallCommand(toolName: string, args: Record<string, unknown> | null): string {
  if (!args) return toolName;

  const desc = TOOL_TABLE[toolName];
  if (!desc) return formatUnknownToolCommand(toolName, args);

  if (desc.formatCommand) {
    return desc.formatCommand(toolName, args);
  }

  const primary = getFirstStringField(args, desc.argKeys) ?? "";

  // Bash is special: display the command itself, not "Bash <command>"
  if (toolName === "Bash" || toolName === "bash") {
    return primary || toolName;
  }

  // Grep is special: include query + path
  if (desc.secondaryArgKeys) {
    const secondary = getFirstStringField(args, desc.secondaryArgKeys);
    return `${toolName} '${primary}'${secondary ? ` in ${secondary}` : ""}`;
  }

  return `${toolName} ${primary}`.trim();
}

export function formatToolCallOutput(
  toolName: string,
  output: string,
): string {
  const desc = TOOL_TABLE[toolName];
  if (!desc?.formatOutput) {
    return output;
  }
  return desc.formatOutput(output);
}

function formatUnknownToolCommand(toolName: string, args: Record<string, unknown>): string {
  const entries = Object.entries(args).filter(([, v]) => v !== undefined);
  if (entries.length === 0) return toolName;
  const compact = entries.map(([k, v]) => {
    const vs = typeof v === "string" ? v : JSON.stringify(v);
    const display = vs.length > 40 ? `${vs.slice(0, 37)}...` : vs;
    return `${k}: ${display}`;
  }).join(", ");
  return `${toolName} { ${compact} }`;
}

export function isExploringIntent(intent: ViewToolParsedIntent): boolean {
  return (
    intent.type === "read" ||
    intent.type === "list_files" ||
    intent.type === "search"
  );
}

export function isExploringCall(call: Pick<ViewToolCallSummary, "parsedCmd">): boolean {
  if (call.parsedCmd.length === 0) return false;
  return call.parsedCmd.every((intent) => isExploringIntent(intent));
}
