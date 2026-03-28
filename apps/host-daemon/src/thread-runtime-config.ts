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

const MANAGER_DYNAMIC_TOOLS: DynamicTool[] = [
  {
    name: "message_user",
    description: "Send a user-visible update from the manager thread.",
    inputSchema: MESSAGE_USER_TOOL_SCHEMA,
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
