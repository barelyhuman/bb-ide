import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  DynamicTool,
  ThreadExecutionOptions,
} from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { renderTemplate } from "@bb/templates";

const STANDARD_AGENT_INSTRUCTIONS = renderTemplate(
  "standardAgentInstructions",
  {},
);

const MANAGER_PREFERENCES_FILE_NAME = "PREFERENCES.md";
const NO_MANAGER_PREFERENCES = "No preferences yet.";

const MESSAGE_USER_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    text: {
      type: "string",
      description: "User-visible message text.",
    },
  },
  required: ["text"],
};

const SPAWN_THREAD_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: {
      type: "string",
      description: "Primary task prompt for the child thread.",
    },
    environmentId: {
      type: "string",
      description: "Existing environment to reuse for the child thread.",
    },
    hostId: {
      type: "string",
      description: "Host to run the child thread on when creating a new environment.",
    },
    providerId: {
      type: "string",
      description: "Provider for the child thread.",
    },
    type: {
      type: "string",
      enum: ["standard", "manager"],
      description: "Thread type for the child thread.",
    },
    title: {
      type: "string",
      description: "Human-readable child thread title.",
    },
    model: {
      type: "string",
      description: "Model override for the child thread.",
    },
    reasoningLevel: {
      type: "string",
      enum: ["low", "medium", "high", "xhigh"],
      description: "Reasoning effort for the child thread.",
    },
    sandboxMode: {
      type: "string",
      enum: ["read-only", "workspace-write", "danger-full-access"],
      description: "Sandbox mode for the child thread.",
    },
  },
  required: ["prompt"],
};

const MANAGER_DYNAMIC_TOOLS: DynamicTool[] = [
  {
    name: "message_user",
    description: "Send a user-visible update from the manager thread.",
    inputSchema: MESSAGE_USER_TOOL_SCHEMA,
  },
  {
    name: "spawn_thread",
    description: "Create a BB child thread to own substantive work.",
    inputSchema: SPAWN_THREAD_TOOL_SCHEMA,
  },
];

type ThreadRuntimeConfigCommand = Extract<
  HostDaemonCommand,
  { type: "thread.start" | "thread.resume" | "turn.run" | "turn.steer" }
>;

interface ThreadRuntimeConfig {
  dynamicTools?: DynamicTool[];
  instructions?: string;
  options?: ThreadExecutionOptions;
}

async function readManagerPreferences(workspacePath: string): Promise<string> {
  try {
    return await readFile(
      path.join(workspacePath, MANAGER_PREFERENCES_FILE_NAME),
      "utf8",
    );
  } catch {
    return NO_MANAGER_PREFERENCES;
  }
}

function mergeDynamicTools(dynamicTools: DynamicTool[] | undefined): DynamicTool[] {
  const merged = [...(dynamicTools ?? [])];
  const existingNames = new Set(merged.map((tool) => tool.name));

  for (const managerTool of MANAGER_DYNAMIC_TOOLS) {
    if (existingNames.has(managerTool.name)) {
      continue;
    }
    merged.push(managerTool);
  }

  return merged;
}

export async function resolveThreadRuntimeConfig(
  command: ThreadRuntimeConfigCommand,
): Promise<ThreadRuntimeConfig> {
  if (command.threadType !== "manager") {
    return {
      ...(command.dynamicTools ? { dynamicTools: command.dynamicTools } : {}),
      instructions: STANDARD_AGENT_INSTRUCTIONS,
      ...(command.options ? { options: command.options } : {}),
    };
  }

  const instructions = renderTemplate("managerAgentInstructions", {
    managerPreferencesContent: await readManagerPreferences(command.workspacePath),
    managerThreadId: command.threadId,
    managerWorkspacePath: command.workspacePath,
    projectId: command.projectId,
    projectName: command.projectName,
    projectRootPath: command.projectRootPath,
  });

  return {
    dynamicTools: mergeDynamicTools(command.dynamicTools),
    instructions,
    ...(command.options ? { options: command.options } : {}),
  };
}
