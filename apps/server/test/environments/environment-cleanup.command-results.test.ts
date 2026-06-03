import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  fetchCommands,
  getActiveCommandAttemptForCommand,
  getCommand,
  getEnvironment,
  getEnvironmentOperation,
  migrate,
  queueCommand,
  upsertHost,
  type DbConnection,
} from "@bb/db";
import {
  markEnvironmentOperationRecordQueued,
  setEnvironmentStatus,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import {
  cancelPendingEnvironmentCleanup,
  requestEnvironmentCleanup,
  settleEnvironmentDestroyCommandResult,
  type SettleEnvironmentDestroyCommandResultArgs,
} from "../../src/services/environments/environment-lifecycle-owner.js";
import { NotificationHub } from "../../src/ws/hub.js";

type EnvironmentDestroyCommand =
  SettleEnvironmentDestroyCommandResultArgs["command"];
type EnvironmentDestroyCommandResultReport =
  SettleEnvironmentDestroyCommandResultArgs["report"];

interface EnvironmentCleanupCommandResultSetup {
  db: DbConnection;
  environmentId: string;
  hostId: string;
  hub: NotificationHub;
}

interface SettleDestroyReportArgs {
  command: EnvironmentDestroyCommand;
  commandRow: SettleEnvironmentDestroyCommandResultArgs["commandRow"];
  report: EnvironmentDestroyCommandResultReport;
  testSetup: EnvironmentCleanupCommandResultSetup;
}

function setup(): EnvironmentCleanupCommandResultSetup {
  const db = createConnection(":memory:");
  migrate(db);

  const hub = new NotificationHub();
  const host = upsertHost(db, hub, {
    name: "test-host",
    type: "persistent",
  });
  const { project } = createProject(db, hub, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/source" },
  });
  const environment = createEnvironment(db, hub, {
    projectId: project.id,
    hostId: host.id,
    managed: true,
    workspaceProvisionType: "managed-worktree",
    path: "/tmp/environment-cleanup-command-results",
    status: "ready",
  });

  return {
    db,
    environmentId: environment.id,
    hostId: host.id,
    hub,
  };
}

function settleDestroyReport(args: SettleDestroyReportArgs) {
  return args.testSetup.db.transaction(
    (tx) =>
      settleEnvironmentDestroyCommandResult({
        command: args.command,
        commandRow: args.commandRow,
        deps: {
          db: tx,
          hub: args.testSetup.hub,
        },
        report: args.report,
      }),
    { behavior: "immediate" },
  );
}

describe("environment cleanup command result settlement", () => {
  it("atomically cancels pending environment cleanup lifecycle state", () => {
    const testSetup = setup();
    setEnvironmentStatus(testSetup.db, testSetup.hub, testSetup.environmentId, {
      status: "destroying",
    });
    requestEnvironmentCleanup(testSetup, {
      environmentId: testSetup.environmentId,
    });
    const commandPayload: EnvironmentDestroyCommand = {
      type: "environment.destroy",
      environmentId: testSetup.environmentId,
      workspaceContext: {
        workspacePath: "/tmp/environment-cleanup-command-results",
        workspaceProvisionType: "managed-worktree",
      },
    };
    const command = queueCommand(testSetup.db, testSetup.hub, {
      hostId: testSetup.hostId,
      sessionId: null,
      type: "environment.destroy",
      payload: JSON.stringify(commandPayload),
    });
    markEnvironmentOperationRecordQueued(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
      commandId: command.id,
    });

    expect(
      cancelPendingEnvironmentCleanup(testSetup, {
        environmentId: testSetup.environmentId,
      }),
    ).toBe("cancelled");

    expect(getCommand(testSetup.db, command.id)).toMatchObject({
      state: "error",
      resultPayload: JSON.stringify({
        errorCode: "environment_cleanup_cancelled",
        errorMessage: "Environment cleanup was cancelled",
      }),
    });
    expect(
      getActiveCommandAttemptForCommand(testSetup.db, command.id),
    ).toBeNull();
    expect(
      getEnvironmentOperation(testSetup.db, {
        environmentId: testSetup.environmentId,
        kind: "destroy",
      }),
    ).toMatchObject({
      state: "cancelled",
      commandId: command.id,
    });
    expect(getEnvironment(testSetup.db, testSetup.environmentId)).toMatchObject(
      {
        cleanupMode: null,
        cleanupRequestedAt: null,
        status: "ready",
      },
    );
  });

  it("preserves fetched environment cleanup state as in progress", () => {
    const testSetup = setup();
    setEnvironmentStatus(testSetup.db, testSetup.hub, testSetup.environmentId, {
      status: "destroying",
    });
    requestEnvironmentCleanup(testSetup, {
      environmentId: testSetup.environmentId,
    });
    const commandPayload: EnvironmentDestroyCommand = {
      type: "environment.destroy",
      environmentId: testSetup.environmentId,
      workspaceContext: {
        workspacePath: "/tmp/environment-cleanup-command-results",
        workspaceProvisionType: "managed-worktree",
      },
    };
    const command = queueCommand(testSetup.db, testSetup.hub, {
      hostId: testSetup.hostId,
      sessionId: null,
      type: "environment.destroy",
      payload: JSON.stringify(commandPayload),
    });
    markEnvironmentOperationRecordQueued(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
      commandId: command.id,
    });

    expect(
      fetchCommands(testSetup.db, testSetup.hub, {
        hostId: testSetup.hostId,
        sessionId: null,
      }),
    ).toHaveLength(1);
    const commandBefore = getCommand(testSetup.db, command.id);
    const attemptBefore = getActiveCommandAttemptForCommand(
      testSetup.db,
      command.id,
    );
    const operationBefore = getEnvironmentOperation(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
    });
    const environmentBefore = getEnvironment(
      testSetup.db,
      testSetup.environmentId,
    );

    expect(commandBefore).toMatchObject({ state: "fetched" });
    expect(attemptBefore).not.toBeNull();

    expect(
      cancelPendingEnvironmentCleanup(testSetup, {
        environmentId: testSetup.environmentId,
      }),
    ).toBe("in_progress");

    expect(getCommand(testSetup.db, command.id)).toEqual(commandBefore);
    expect(getActiveCommandAttemptForCommand(testSetup.db, command.id)).toEqual(
      attemptBefore,
    );
    expect(
      getEnvironmentOperation(testSetup.db, {
        environmentId: testSetup.environmentId,
        kind: "destroy",
      }),
    ).toEqual(operationBefore);
    expect(getEnvironment(testSetup.db, testSetup.environmentId)).toEqual(
      environmentBefore,
    );
  });

  it("settles environment destroy once and ignores duplicate terminal results", () => {
    const testSetup = setup();
    setEnvironmentStatus(testSetup.db, testSetup.hub, testSetup.environmentId, {
      status: "destroying",
    });
    const commandPayload: EnvironmentDestroyCommand = {
      type: "environment.destroy",
      environmentId: testSetup.environmentId,
      workspaceContext: {
        workspacePath: "/tmp/workspace",
        workspaceProvisionType: "managed-worktree",
      },
    };
    const command = queueCommand(testSetup.db, testSetup.hub, {
      hostId: testSetup.hostId,
      sessionId: null,
      type: "environment.destroy",
      payload: JSON.stringify(commandPayload),
    });
    upsertEnvironmentOperationRecord(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
      payload: JSON.stringify({}),
    });
    markEnvironmentOperationRecordQueued(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
      commandId: command.id,
    });

    const successReport: EnvironmentDestroyCommandResultReport = {
      attemptId: "attempt-destroy",
      commandId: command.id,
      completedAt: 500,
      ok: true,
      result: {},
      type: "environment.destroy",
    };
    const sideEffects = settleDestroyReport({
      command: commandPayload,
      commandRow: command,
      report: successReport,
      testSetup,
    });

    expect(sideEffects.postCommitActions).toEqual([
      expect.objectContaining({
        context: {
          environmentId: testSetup.environmentId,
        },
        name: "Terminal cleanup after environment destroy",
      }),
    ]);
    expect(getEnvironment(testSetup.db, testSetup.environmentId)).toMatchObject(
      {
        status: "destroyed",
      },
    );
    const completed = getEnvironmentOperation(testSetup.db, {
      environmentId: testSetup.environmentId,
      kind: "destroy",
    });
    expect(completed).toMatchObject({
      state: "completed",
      commandId: command.id,
      failureReason: null,
    });

    const duplicateFailureReport: EnvironmentDestroyCommandResultReport = {
      attemptId: "attempt-destroy",
      commandId: command.id,
      completedAt: 600,
      errorCode: "late_destroy_failure",
      errorMessage: "destroy failed late",
      ok: false,
      type: "environment.destroy",
    };
    settleDestroyReport({
      command: commandPayload,
      commandRow: command,
      report: duplicateFailureReport,
      testSetup,
    });

    expect(
      getEnvironmentOperation(testSetup.db, {
        environmentId: testSetup.environmentId,
        kind: "destroy",
      }),
    ).toMatchObject({
      state: "completed",
      commandId: command.id,
      completedAt: completed?.completedAt,
      failureReason: null,
    });
    expect(getEnvironment(testSetup.db, testSetup.environmentId)).toMatchObject(
      {
        status: "destroyed",
      },
    );
  });
});
