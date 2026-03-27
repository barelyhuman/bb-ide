import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { dispatchCommand } from "../../src/command-dispatch.js";
import { RuntimeManager } from "../../src/runtime-manager.js";
import {
  cleanupTempDirs,
  createFakeRuntime,
  createFakeWorkspace,
  createHarness,
  makeTempDir,
} from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

describe("thread command dispatch", () => {
  it("covers thread lifecycle commands", async () => {
    const harness = createHarness();

    const startResult = await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-1",
        threadId: "thread-1",
        workspacePath: "/tmp/env-1",
        projectId: "project-1",
        projectName: "Project 1",
        projectRootPath: "/tmp/project-1",
        providerId: "fake",
        threadType: "standard",
      },
      { runtimeManager: harness.manager },
    );
    const resumeResult = await dispatchCommand(
      {
        type: "thread.resume",
        environmentId: "env-1",
        threadId: "thread-1",
        workspacePath: "/tmp/env-1",
        projectId: "project-1",
        projectName: "Project 1",
        projectRootPath: "/tmp/project-1",
        providerId: "fake",
        threadType: "standard",
        providerThreadId: "provider-1",
      },
      { runtimeManager: harness.manager },
    );
    const renameResult = await dispatchCommand(
      {
        type: "thread.rename",
        environmentId: "env-1",
        threadId: "thread-1",
        title: "Renamed",
      },
      { runtimeManager: harness.manager },
    );
    const stopResult = await dispatchCommand(
      {
        type: "thread.stop",
        environmentId: "env-1",
        threadId: "thread-1",
      },
      { runtimeManager: harness.manager },
    );

    expect(startResult).toEqual({ providerThreadId: "provider-thread-1" });
    expect(resumeResult).toEqual({ providerThreadId: "provider-1" });
    expect(renameResult).toEqual({});
    expect(stopResult).toEqual({});
    expect(harness.runtimeState.startedThreadId).toBe("thread-1");
    expect(harness.runtimeState.startedInstructions).toContain("coding agent");
    expect(harness.runtimeState.resumedThreadId).toBe("thread-1");
    expect(harness.runtimeState.resumedInstructions).toContain("coding agent");
    expect(harness.runtimeState.renamedTitle).toBe("Renamed");
    expect(harness.runtimeState.stoppedThreadId).toBe("thread-1");
    expect(harness.manager.listActiveThreads()).toEqual([]);
  });

  it("covers turn.run and turn.steer", async () => {
    const harness = createHarness();
    await harness.manager.ensureEnvironment({
      environmentId: "env-1",
      workspacePath: "/tmp/env-1",
    });
    harness.manager.markThreadActive("env-1", "thread-1", "provider-1");

    const runResult = await dispatchCommand(
      {
        type: "turn.run",
        environmentId: "env-1",
        threadId: "thread-1",
        workspacePath: "/tmp/env-1",
        projectId: "project-1",
        projectName: "Project 1",
        projectRootPath: "/tmp/project-1",
        providerId: "fake",
        threadType: "standard",
        providerThreadId: "provider-1",
        eventSequence: 3,
        input: [{ type: "text", text: "hello" }],
      },
      { runtimeManager: harness.manager },
    );
    const steerResult = await dispatchCommand(
      {
        type: "turn.steer",
        environmentId: "env-1",
        threadId: "thread-1",
        workspacePath: "/tmp/env-1",
        projectId: "project-1",
        projectName: "Project 1",
        projectRootPath: "/tmp/project-1",
        providerId: "fake",
        threadType: "standard",
        providerThreadId: "provider-1",
        eventSequence: 4,
        expectedTurnId: "turn-1",
        input: [{ type: "text", text: "adjust" }],
      },
      { runtimeManager: harness.manager },
    );

    expect(runResult).toEqual({});
    expect(steerResult).toEqual({});
    expect(harness.runtimeState.ranTurnText).toBe("hello");
    expect(harness.runtimeState.steeredTurnId).toBe("turn-1");
  });

  it("lazily resumes a missing thread runtime before turn.run", async () => {
    const harness = createHarness({ workspacePath: "/tmp/env-lazy" });

    const result = await dispatchCommand(
      {
        type: "turn.run",
        environmentId: "env-lazy",
        threadId: "thread-1",
        workspacePath: "/tmp/env-lazy",
        projectId: "project-1",
        projectName: "Project 1",
        projectRootPath: "/tmp/project-1",
        providerId: "fake",
        threadType: "standard",
        providerThreadId: "provider-1",
        eventSequence: 1,
        input: [{ type: "text", text: "hello" }],
      },
      { runtimeManager: harness.manager },
    );

    expect(result).toEqual({});
    expect(harness.provisions).toEqual([
      {
        workspaceProvisionType: "unmanaged",
        path: "/tmp/env-lazy",
      },
    ]);
    expect(harness.runtimeState.resumedProviderThreadId).toBe("provider-1");
    expect(harness.runtimeState.ranTurnText).toBe("hello");
  });

  it("re-resolves thread runtime after provider exit clears known threads", async () => {
    const { runtime, state } = createFakeRuntime();
    const { workspace } = createFakeWorkspace("/tmp/env-exit");
    let onProcessExit:
      | ((info: {
          code: number | null;
          providerId: string;
          signal: string | null;
          threadIds: string[];
        }) => void)
      | undefined;
    const manager = new RuntimeManager({
      provisionWorkspace: async () => workspace,
      createRuntime: (options) => {
        onProcessExit = options.onProcessExit;
        return runtime;
      },
    });

    await manager.ensureEnvironment({
      environmentId: "env-exit",
      workspacePath: "/tmp/env-exit",
    });
    manager.markThreadActive("env-exit", "thread-1", "provider-1");
    onProcessExit?.({
      providerId: "fake",
      threadIds: ["thread-1"],
      code: 1,
      signal: null,
    });

    const result = await dispatchCommand(
      {
        type: "turn.run",
        environmentId: "env-exit",
        threadId: "thread-1",
        workspacePath: "/tmp/env-exit",
        projectId: "project-1",
        projectName: "Project 1",
        projectRootPath: "/tmp/project-1",
        providerId: "fake",
        threadType: "standard",
        providerThreadId: "provider-1",
        eventSequence: 2,
        input: [{ type: "text", text: "after exit" }],
      },
      { runtimeManager: manager },
    );

    expect(result).toEqual({});
    expect(state.resumedThreadId).toBe("thread-1");
    expect(state.ranTurnText).toBe("after exit");
  });

  it("covers provider.list", async () => {
    const harness = createHarness();

    const result = await dispatchCommand(
      {
        type: "provider.list",
      },
      {
        runtimeManager: harness.manager,
        listProviders: () => [
          {
            id: "fake",
            displayName: "Fake Provider",
            capabilities: {
              supportsRename: false,
              supportsServiceTier: false,
            },
            available: true,
          },
        ],
      },
    );

    expect(result).toEqual({
      providers: [
        {
          id: "fake",
          displayName: "Fake Provider",
          capabilities: {
            supportsRename: false,
            supportsServiceTier: false,
          },
          available: true,
        },
      ],
    });
  });

  it("covers provider.list_models", async () => {
    const harness = createHarness();

    const result = await dispatchCommand(
      {
        type: "provider.list_models",
        providerId: "fake",
      },
      {
        runtimeManager: harness.manager,
        listModels: async () => [
          {
            id: "model-1",
            model: "model-1",
            displayName: "Model 1",
            description: "Test model",
            supportedReasoningEfforts: [],
            defaultReasoningEffort: "medium",
            isDefault: true,
          },
        ],
      },
    );

    expect(result).toEqual({
      models: [
        {
          id: "model-1",
          model: "model-1",
          displayName: "Model 1",
          description: "Test model",
          supportedReasoningEfforts: [],
          defaultReasoningEffort: "medium",
          isDefault: true,
        },
      ],
    });
  });

  it("resolves manager runtime config inside the daemon", async () => {
    const managerWorkspace = await makeTempDir("bb-manager-runtime-");
    await fs.writeFile(
      path.join(managerWorkspace, "PREFERENCES.md"),
      "Prefer concise user updates.\nDelegate implementation quickly.\n",
      "utf8",
    );
    const harness = createHarness({ workspacePath: managerWorkspace });

    await dispatchCommand(
      {
        type: "thread.start",
        environmentId: "env-manager",
        threadId: "thread-manager",
        workspacePath: managerWorkspace,
        projectId: "project-1",
        projectName: "Manager Project",
        projectRootPath: "/tmp/manager-project",
        providerId: "fake",
        threadType: "manager",
      },
      { runtimeManager: harness.manager },
    );

    expect(harness.runtimeState.startedDynamicTools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "message_user" }),
        expect.objectContaining({ name: "spawn_thread" }),
      ]),
    );
    expect(harness.runtimeState.startedInstructions).toContain(
      "You are a manager for this project.",
    );
    expect(harness.runtimeState.startedInstructions).toContain(
      "Prefer concise user updates.",
    );
    expect(harness.runtimeState.startedInstructions).toContain(
      "Delegate implementation quickly.",
    );
    expect(harness.runtimeState.startedInstructions).toContain(
      "Manager Project",
    );
    expect(harness.runtimeState.startedInstructions).toContain(
      managerWorkspace,
    );
  });
});
