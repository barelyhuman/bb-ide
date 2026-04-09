import { describe, expect, it } from "vitest";
import {
  resolveExecutionOptions,
  resolveThreadRuntimeCommandConfig,
} from "../../src/services/threads/thread-runtime-config.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

function resolveLocalTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

describe("thread runtime config", () => {
  it("defaults Codex execution approval policy to on-request", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-approval-policy",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.approvalPolicy).toBe("on-request");
    } finally {
      await harness.cleanup();
    }
  });

  it("defaults question policy to allow for persistent root threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-question-policy-default",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: thread.id,
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.questionPolicy).toBe("allow");
    } finally {
      await harness.cleanup();
    }
  });

  it("defaults question policy to avoid for worker threads and sandbox-host threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host: persistentHost } = seedHostSession(harness.deps, {
        id: "host-runtime-question-policy-worker",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: persistentHost.id,
      });
      const persistentEnvironment = seedEnvironment(harness.deps, {
        hostId: persistentHost.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: persistentEnvironment.id,
      });
      const workerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: persistentEnvironment.id,
        parentThreadId: parentThread.id,
      });

      const { host: sandboxHost } = seedHostSession(harness.deps, {
        id: "host-runtime-question-policy-sandbox",
        type: "ephemeral",
      });
      const sandboxEnvironment = seedEnvironment(harness.deps, {
        hostId: sandboxHost.id,
        projectId: project.id,
      });
      const sandboxThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: sandboxEnvironment.id,
      });

      const workerExecution = await resolveExecutionOptions(harness.deps, {
        threadId: workerThread.id,
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });
      const sandboxExecution = await resolveExecutionOptions(harness.deps, {
        threadId: sandboxThread.id,
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(workerExecution.questionPolicy).toBe("avoid");
      expect(sandboxExecution.questionPolicy).toBe("avoid");
    } finally {
      await harness.cleanup();
    }
  });

  it("defaults approval policy to never for child threads", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, {
        id: "host-runtime-child-approval-policy",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: host.id,
        projectId: project.id,
      });
      const parentThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
      });
      const childThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        providerId: "codex",
        parentThreadId: parentThread.id,
      });

      const execution = await resolveExecutionOptions(harness.deps, {
        threadId: childThread.id,
        requestedExecution: {
          model: "gpt-5",
          source: "client/turn/requested",
        },
      });

      expect(execution.approvalPolicy).toBe("never");
    } finally {
      await harness.cleanup();
    }
  });

  it("uses the project root as cwd and a host data-dir workspace for managers", async () => {
    const harness = await createTestAppHarness();
    try {
      const hostId = "host-runtime";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/runtime-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/runtime-project-root",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });

      const runtimeConfig = await resolveThreadRuntimeCommandConfig(harness.deps, {
        thread: managerThread,
        environment: {
          hostId: environment.hostId,
          id: environment.id,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        isThreadCreation: true,
        questionPolicy: "allow",
      });

      expect(runtimeConfig.instructions).toContain(
        "Project root: `/tmp/runtime-project-root`",
      );
      expect(runtimeConfig.instructions).toContain(
        `Thread storage: \`/tmp/bb-host-data/${hostId}/thread-storage/${managerThread.id}\``,
      );
      expect(runtimeConfig.instructions).toContain(
        `Local timezone: \`${resolveLocalTimezone()}\``,
      );
    } finally {
      await harness.cleanup();
    }
  });

  it("reads manager preferences from the thread storage on the host", async () => {
    const harness = await createTestAppHarness();
    try {
      const hostId = "host-runtime-preferences";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/runtime-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/runtime-project-root",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const threadStoragePath = `/tmp/bb-host-data/${hostId}/thread-storage/${managerThread.id}`;
      const preferencesPath = `${threadStoragePath}/PREFERENCES.md`;

      const runtimeConfigPromise = resolveThreadRuntimeCommandConfig(harness.deps, {
        thread: managerThread,
        environment: {
          hostId: environment.hostId,
          id: environment.id,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        questionPolicy: "allow",
      });

      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "host.read_file" &&
          candidate.command.path === preferencesPath,
      );
      if (queued.command.type !== "host.read_file") {
        throw new Error(`Expected host.read_file, got ${queued.command.type}`);
      }
      expect(queued.command.rootPath).toBe(threadStoragePath);

      const response = await reportQueuedCommandSuccess(
        harness,
        { command: queued.command, row: queued.row },
        {
          path: preferencesPath,
          content: "# Preferences\n\n- terse updates\n",
          contentEncoding: "utf8",
          mimeType: "text/markdown",
          sizeBytes: "# Preferences\n\n- terse updates\n".length,
        },
      );
      expect(response.status).toBe(200);

      const runtimeConfig = await runtimeConfigPromise;
      expect(runtimeConfig.instructions).toContain(
        "Project root: `/tmp/runtime-project-root`",
      );
      expect(runtimeConfig.instructions).toContain(
        `Thread storage: \`${threadStoragePath}\``,
      );
      expect(runtimeConfig.instructions).toContain(
        `Local timezone: \`${resolveLocalTimezone()}\``,
      );
      expect(runtimeConfig.instructions).toContain("# Preferences");
      expect(runtimeConfig.instructions).toContain("terse updates");
    } finally {
      await harness.cleanup();
    }
  });

  it("treats missing manager preferences as an empty thread storage", async () => {
    const harness = await createTestAppHarness();
    try {
      const hostId = "host-runtime-missing-preferences";
      seedHostSession(harness.deps, { id: hostId });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId,
        path: "/tmp/runtime-project-root",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId,
        projectId: project.id,
        path: "/tmp/runtime-project-root",
      });
      const managerThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        type: "manager",
      });
      const threadStoragePath = `/tmp/bb-host-data/${hostId}/thread-storage/${managerThread.id}`;
      const preferencesPath = `${threadStoragePath}/PREFERENCES.md`;

      const runtimeConfigPromise = resolveThreadRuntimeCommandConfig(harness.deps, {
        thread: managerThread,
        environment: {
          hostId: environment.hostId,
          id: environment.id,
          path: environment.path,
          workspaceProvisionType: environment.workspaceProvisionType,
        },
        questionPolicy: "allow",
      });

      const queued = await waitForQueuedCommand(
        harness,
        (candidate) =>
          candidate.command.type === "host.read_file" &&
          candidate.command.path === preferencesPath,
      );
      if (queued.command.type !== "host.read_file") {
        throw new Error(`Expected host.read_file, got ${queued.command.type}`);
      }
      expect(queued.command.rootPath).toBe(threadStoragePath);
      const response = await reportQueuedCommandError(harness, queued, {
        errorCode: "ENOENT",
        errorMessage: `Path does not exist: ${preferencesPath}`,
      });
      expect(response.status).toBe(200);

      const runtimeConfig = await runtimeConfigPromise;
      expect(runtimeConfig.instructions).toContain("(file does not exist)");
    } finally {
      await harness.cleanup();
    }
  });

});
