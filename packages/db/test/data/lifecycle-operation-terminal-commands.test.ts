import { describe, expect, it } from "vitest";
import { createConnection } from "../../src/connection.js";
import { migrate } from "../../src/migrate.js";
import { noopNotifier } from "../../src/notifier.js";
import {
  queueCommand,
  reportCommandResult,
} from "../../src/data/commands.js";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import { listActiveLifecycleOperationTerminalCommands } from "../../src/data/lifecycle-operation-terminal-commands.js";
import {
  markEnvironmentOperationRecordQueued,
  upsertEnvironmentOperationRecord,
} from "../../src/data/environment-operations.js";
import {
  markHostOperationRecordQueued,
  upsertHostOperationRecord,
} from "../../src/data/host-operations.js";
import {
  markProjectOperationRecordCompleted,
  markProjectOperationRecordQueued,
  upsertProjectOperationRecord,
} from "../../src/data/project-operations.js";
import {
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "../../src/data/thread-operations.js";
import { createProject } from "../../src/data/projects.js";
import { createThread } from "../../src/data/threads.js";

function setup() {
  const db = createConnection(":memory:");
  migrate(db);
  const host = upsertHost(db, noopNotifier, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    projectId: project.id,
    hostId: host.id,
    workspaceProvisionType: "unmanaged",
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "openai",
  });

  return { db, environment, host, project, thread };
}

function sortTerminalCommandEntries<T extends { owner: string }>(entries: T[]): T[] {
  return [...entries].sort((left, right) => left.owner.localeCompare(right.owner));
}

describe("active lifecycle operation terminal commands", () => {
  it("lists terminal commands attached to active lifecycle operations", () => {
    const { db, environment, host, project, thread } = setup();
    const environmentCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      type: "environment.destroy",
      payload: JSON.stringify({
        type: "environment.destroy",
        environmentId: environment.id,
        workspaceContext: {
          workspacePath: "/tmp/test",
          workspaceProvisionType: "unmanaged",
        },
      }),
    });
    const threadCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      type: "thread.stop",
      payload: JSON.stringify({
        type: "thread.stop",
        environmentId: environment.id,
        threadId: thread.id,
      }),
    });
    const hostCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      type: "host.sync_runtime_material",
      payload: JSON.stringify({
        type: "host.sync_runtime_material",
        version: "runtime-version",
      }),
    });
    const completedProjectCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      type: "environment.destroy",
      payload: JSON.stringify({
        type: "environment.destroy",
        environmentId: environment.id,
        workspaceContext: {
          workspacePath: "/tmp/test",
          workspaceProvisionType: "unmanaged",
        },
      }),
    });

    upsertEnvironmentOperationRecord(db, {
      environmentId: environment.id,
      kind: "destroy",
      payload: "{}",
    });
    markEnvironmentOperationRecordQueued(db, {
      environmentId: environment.id,
      kind: "destroy",
      commandId: environmentCommand.id,
    });
    upsertThreadOperationRecord(db, {
      threadId: thread.id,
      kind: "stop",
      payload: "{}",
    });
    markThreadOperationRecordQueued(db, {
      threadId: thread.id,
      kind: "stop",
      commandId: threadCommand.id,
    });
    upsertHostOperationRecord(db, {
      hostId: host.id,
      kind: "sync_runtime_material",
      payload: "{}",
    });
    markHostOperationRecordQueued(db, {
      hostId: host.id,
      kind: "sync_runtime_material",
      commandId: hostCommand.id,
    });
    upsertProjectOperationRecord(db, {
      projectId: project.id,
      kind: "delete",
      payload: "{}",
    });
    markProjectOperationRecordQueued(db, {
      projectId: project.id,
      kind: "delete",
      commandId: completedProjectCommand.id,
    });
    markProjectOperationRecordCompleted(db, {
      projectId: project.id,
      kind: "delete",
    });

    reportCommandResult(db, noopNotifier, {
      commandId: environmentCommand.id,
      completedAt: 1_000,
      state: "success",
      resultPayload: "{}",
    });
    reportCommandResult(db, noopNotifier, {
      commandId: threadCommand.id,
      completedAt: 1_001,
      state: "error",
      resultPayload: "{}",
    });
    reportCommandResult(db, noopNotifier, {
      commandId: hostCommand.id,
      completedAt: 1_001,
      state: "success",
      resultPayload: "{}",
    });
    reportCommandResult(db, noopNotifier, {
      commandId: completedProjectCommand.id,
      completedAt: 1_002,
      state: "success",
      resultPayload: "{}",
    });

    expect(
      sortTerminalCommandEntries(
        listActiveLifecycleOperationTerminalCommands(db).map((entry) => ({
          commandId: entry.command.id,
          owner: entry.owner,
        })),
      ),
    ).toEqual(
      sortTerminalCommandEntries([
        {
          commandId: environmentCommand.id,
          owner: "environment",
        },
        {
          commandId: threadCommand.id,
          owner: "thread",
        },
        {
          commandId: hostCommand.id,
          owner: "host",
        },
      ]),
    );
  });

  it("lists terminal commands attached to active project lifecycle operations", () => {
    const db = createConnection(":memory:");
    migrate(db);
    const host = upsertHost(db, noopNotifier, {
      name: "project-host",
      type: "persistent",
    });
    const { project } = createProject(db, noopNotifier, {
      name: "project-delete",
      source: {
        type: "local_path",
        hostId: host.id,
        path: "/tmp/project-delete",
      },
    });
    const projectCommand = queueCommand(db, noopNotifier, {
      hostId: host.id,
      type: "environment.destroy",
      payload: JSON.stringify({
        type: "environment.destroy",
        environmentId: "env-unused",
        workspaceContext: {
          workspacePath: "/tmp/project-delete",
          workspaceProvisionType: "unmanaged",
        },
      }),
    });

    upsertProjectOperationRecord(db, {
      projectId: project.id,
      kind: "delete",
      payload: "{}",
    });
    markProjectOperationRecordQueued(db, {
      projectId: project.id,
      kind: "delete",
      commandId: projectCommand.id,
    });
    reportCommandResult(db, noopNotifier, {
      commandId: projectCommand.id,
      completedAt: 2_000,
      state: "success",
      resultPayload: "{}",
    });

    expect(
      listActiveLifecycleOperationTerminalCommands(db).map((entry) => ({
        commandId: entry.command.id,
        owner: entry.owner,
      })),
    ).toEqual([
      {
        commandId: projectCommand.id,
        owner: "project",
      },
    ]);
  });
});
