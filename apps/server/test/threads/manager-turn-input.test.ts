import { describe, expect, it } from "vitest";
import type { AgentProviderId } from "@bb/agent-providers";
import { getLatestThreadSequence } from "@bb/db";
import type {
  PromptInput,
  ResolvedThreadExecutionOptions,
  ThreadType,
} from "@bb/domain";
import type { TurnSubmitTarget } from "@bb/host-daemon-contract";
import type { PreparedTurnSubmitCommandPayload } from "../../src/services/threads/thread-commands.js";
import { prepareTurnSubmitCommandPayload } from "../../src/services/threads/thread-commands.js";
import { findThreadEvent } from "../../src/services/threads/thread-data.js";
import { sendThreadMessage } from "../../src/services/threads/thread-send.js";
import {
  listQueuedThreadCommands,
  reportQueuedCommandError,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { textInput, textPrompt } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
  seedTurnStarted,
} from "../helpers/seed.js";
import {
  type TestAppHarness,
  withTestHarness,
} from "../helpers/test-app.js";

interface PrepareTurnSubmitPayloadForThreadArgs {
  input: PromptInput[];
  providerId: AgentProviderId;
  targetMode?: "auto" | "start" | "steer";
  threadType: ThreadType;
}

interface PrepareTurnSubmitPayloadForThreadResult {
  payload: PreparedTurnSubmitCommandPayload;
}

interface ManagerInputCase {
  input: PromptInput[];
  name: string;
}

const managerInputCases: ManagerInputCase[] = [
  {
    input: textInput("continue work"),
    name: "plain text",
  },
  {
    input: [
      { type: "image", url: "https://example.com/context.png" },
      textPrompt("use this image"),
    ],
    name: "attachment with text",
  },
  {
    input: [],
    name: "empty input",
  },
];

const testExecution: ResolvedThreadExecutionOptions = {
  model: "test-model",
  serviceTier: "default",
  reasoningLevel: "medium",
  permissionMode: "full",
  source: "client/turn/requested",
};

function buildTurnSubmitTarget(
  mode: PrepareTurnSubmitPayloadForThreadArgs["targetMode"],
): TurnSubmitTarget {
  switch (mode) {
    case "auto":
      return { mode: "auto", expectedTurnId: null };
    case "steer":
      return { mode: "steer", expectedTurnId: null };
    case "start":
    case undefined:
      return { mode: "start" };
  }
}

async function respondToManagerPreferencesRead(
  harness: TestAppHarness,
  hostId: string,
  threadId: string,
): Promise<void> {
  const preferencesPath = `/tmp/bb-host-data/${hostId}/thread-storage/${threadId}/PREFERENCES.md`;
  const readPreferences = await waitForQueuedCommand(
    harness,
    ({ command, row }) =>
      row.state === "pending" &&
      command.type === "host.read_file" &&
      command.path === preferencesPath,
  );
  const response = await reportQueuedCommandError(harness, readPreferences, {
    errorCode: "ENOENT",
    errorMessage: "File not found",
  });
  expect(response.status).toBe(200);
}

async function prepareTurnSubmitPayloadForThread(
  args: PrepareTurnSubmitPayloadForThreadArgs,
): Promise<PrepareTurnSubmitPayloadForThreadResult> {
  return await withTestHarness(async (harness) => {
    const hostId = `host-manager-input-${args.threadType}-${args.providerId}`;
    const { host } = seedHostSession(harness.deps, { id: hostId });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      environmentId: environment.id,
      projectId: project.id,
      providerId: args.providerId,
      type: args.threadType,
    });

    const payload = await prepareTurnSubmitCommandPayload(harness.deps, {
      environment,
      execution: testExecution,
      input: args.input,
      permissionEscalation: "deny",
      providerThreadId: "provider-thread-manager-input",
      target: buildTurnSubmitTarget(args.targetMode),
      thread,
    });

    return {
      payload,
    };
  });
}

describe("manager turn input", () => {
  it.each(managerInputCases)(
    "preserves manager input for $name",
    async ({ input }) => {
      const { payload } = await prepareTurnSubmitPayloadForThread({
        input,
        providerId: "codex",
        threadType: "manager",
      });

      expect(payload.input).toEqual(input);
    },
  );

  it("leaves standard thread input unchanged", async () => {
    const input = textInput("standard turn");

    const { payload } = await prepareTurnSubmitPayloadForThread({
      input,
      providerId: "codex",
      threadType: "standard",
    });

    expect(payload.input).toEqual(input);
  });

  it("does not append hidden reminders on active manager steers", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host-manager-input-steer",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        environmentId: environment.id,
        projectId: project.id,
        providerId: "codex",
        status: "active",
        type: "manager",
      });
      const providerThreadId = "provider-thread-manager-input-steer";
      seedThreadRuntimeState(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId,
      });
      seedTurnStarted(harness.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId,
        turnId: "turn-manager-input-steer",
      });
      const input = textInput("adjust course");
      const eventSequenceBeforeSend = getLatestThreadSequence(harness.db, {
        threadId: thread.id,
      });

      const sendPromise = sendThreadMessage(harness.deps, {
        environment,
        payload: {
          input,
          mode: "steer",
          model: "gpt-5.4",
          permissionMode: "full",
          reasoningLevel: "medium",
          serviceTier: "default",
        },
        thread,
        trigger: "user",
      });

      await respondToManagerPreferencesRead(harness, host.id, thread.id);
      await sendPromise;

      const commands = listQueuedThreadCommands(
        harness,
        "turn.submit",
        thread.id,
      );
      expect(commands).toHaveLength(1);
      const command = commands[0];
      if (command?.type !== "turn.submit") {
        throw new Error("Expected turn.submit command");
      }
      expect(command.target.mode).toBe("steer");
      expect(command.input).toEqual(input);

      const turnRequestEvent = findThreadEvent(harness.db, {
        afterSeq: eventSequenceBeforeSend,
        threadId: thread.id,
        type: "client/turn/requested",
      });
      if (turnRequestEvent?.type !== "client/turn/requested") {
        throw new Error("Expected client turn requested event");
      }
      expect(turnRequestEvent.data.input).toEqual(input);
    });
  });
});
