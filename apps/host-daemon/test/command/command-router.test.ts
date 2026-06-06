import type {
  HostDaemonCommand,
  HostDaemonOnlineRpcRequestMessage,
  HostDaemonOnlineRpcResponseMessage,
} from "@bb/host-daemon-contract";
import {
  encodeClientTurnRequestIdNumber,
  type ClientTurnRequestId,
  type PromptInput,
} from "@bb/domain";
import { describe, expect, it } from "vitest";
import { CommandRouter } from "../../src/command-router.js";
import { noopEventSink } from "../../src/command-dispatch-support.js";
import {
  createHarness,
  unexpectedProjectAttachmentFetch,
} from "./dispatch-helpers.js";

type EnvironmentDestroyCommand = Extract<
  HostDaemonCommand,
  { type: "environment.destroy" }
>;
type RouterHarness = ReturnType<typeof createHarness>;
type TextPromptInput = Extract<PromptInput, { type: "text" }>;
type TurnSubmitCommand = Extract<HostDaemonCommand, { type: "turn.submit" }>;

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: Error): void;
  resolve(value: T | PromiseLike<T>): void;
}

interface RunRouterCommandArgs {
  command: HostDaemonCommand;
  requestId: string;
  router: CommandRouter;
}

let nextClientRequestIdValue = 1;

function createDeferred<T>(): Deferred<T> {
  let resolveDeferred:
    | ((value: T | PromiseLike<T>) => void)
    | undefined;
  let rejectDeferred: ((error: Error) => void) | undefined;
  const promise = new Promise<T>((resolve, reject) => {
    resolveDeferred = resolve;
    rejectDeferred = reject;
  });
  if (!resolveDeferred || !rejectDeferred) {
    throw new Error("Deferred promise callbacks were not initialized");
  }
  return {
    promise,
    reject: rejectDeferred,
    resolve: resolveDeferred,
  };
}

function createClientRequestId(): ClientTurnRequestId {
  const requestId = encodeClientTurnRequestIdNumber({
    value: nextClientRequestIdValue,
  });
  nextClientRequestIdValue += 1;
  return requestId;
}

function createRouter(harness: RouterHarness): CommandRouter {
  return new CommandRouter({
    dataDir: "/tmp/bb-router-test-data",
    eventSink: noopEventSink,
    fetchProjectAttachment: unexpectedProjectAttachmentFetch,
    logger: {
      debug: () => undefined,
      warn: () => undefined,
    },
    runtimeManager: harness.manager,
    threadStorageRootPath: "/tmp/bb-router-test-thread-storage",
  });
}

function createTurnSubmitCommand(): TurnSubmitCommand {
  return {
    type: "turn.submit",
    environmentId: "env-router",
    threadId: "thread-router",
    requestId: createClientRequestId(),
    input: [textPromptInput("after destroy")],
    options: {
      model: "gpt-5",
      serviceTier: "default",
      reasoningLevel: "medium",
      workflowsEnabled: false,
      permissionMode: "full",
      permissionEscalation: null,
    },
    resumeContext: {
      workspaceContext: {
        workspacePath: "/tmp/env-router",
        workspaceProvisionType: "unmanaged",
      },
      projectId: "project-router",
      providerId: "fake",
      providerThreadId: "provider-thread-router",
      instructions: "Be a helpful coding agent.",
      dynamicTools: [],
      injectedSkillSources: [],
      instructionMode: "append",
    },
    target: { mode: "start" },
  };
}

function textPromptInput(text: string): TextPromptInput {
  return { type: "text", text, mentions: [] };
}

function createEnvironmentDestroyCommand(): EnvironmentDestroyCommand {
  return {
    type: "environment.destroy",
    environmentId: "env-router",
    workspaceContext: {
      workspacePath: "/tmp/env-router",
      workspaceProvisionType: "unmanaged",
    },
  };
}

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

async function runRouterCommand({
  command,
  requestId,
  router,
}: RunRouterCommandArgs): Promise<HostDaemonOnlineRpcResponseMessage> {
  const message: HostDaemonOnlineRpcRequestMessage = {
    type: "host-rpc.request",
    requestId,
    command,
  };
  return router.handleOnlineRpcRequest(message);
}

describe("CommandRouter", () => {
  it("orders turn.submit after an in-flight environment destroy", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-router" });
    await harness.manager.ensureEnvironment({
      environmentId: "env-router",
      workspacePath: "/tmp/env-router",
    });
    const destroyStarted = createDeferred<void>();
    const releaseDestroy = createDeferred<void>();
    harness.workspace.destroy = async () => {
      destroyStarted.resolve();
      await releaseDestroy.promise;
    };

    const router = createRouter(harness);
    const destroyTask = runRouterCommand({
      command: createEnvironmentDestroyCommand(),
      requestId: "destroy-env-router",
      router,
    });
    await destroyStarted.promise;

    const turnTask = runRouterCommand({
      command: createTurnSubmitCommand(),
      requestId: "turn-env-router",
      router,
    });
    await flushAsyncWork();

    expect(harness.runtimeState.ranTurnText).toBeUndefined();

    releaseDestroy.resolve();
    const destroyResponse = await destroyTask;
    expect(destroyResponse.ok).toBe(true);
    const turnResponse = await turnTask;
    expect(turnResponse.ok).toBe(true);
    expect(harness.runtimeState.ranTurnText).toBe("after destroy");
  });
});
