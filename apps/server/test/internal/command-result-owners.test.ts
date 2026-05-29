import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  createConnection,
  createEnvironment,
  createProject,
  getCommand,
  getEnvironment,
  getEnvironmentOperation,
  migrate,
  queueCommand,
  upsertHost,
  type DbConnection,
  type HostDaemonCommandRow,
} from "@bb/db";
import {
  markEnvironmentOperationRecordQueued,
  setEnvironmentStatus,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-lifecycle";
import { defaultFeatureFlags } from "@bb/domain";
import { createLogger } from "@bb/logger";
import {
  handleCommandResultSideEffects,
  type CommandResultSideEffectsDeps,
  type CommandResultSideEffectReport,
} from "../../src/internal/command-result-owners.js";
import { createLifecycleDedupers } from "../../src/lifecycle-dedupers.js";
import { createHostLifecycleService } from "../../src/services/hosts/host-lifecycle-service.js";
import { PendingInteractionLifecycle } from "../../src/services/interactions/pending-interactions.js";
import type { MachineAuthService } from "../../src/services/machine-auth.js";
import { TerminalSessionLifecycle } from "../../src/services/terminals/terminal-session-lifecycle.js";
import { NotificationHub } from "../../src/ws/hub.js";

interface TestCommandResultOwnerSetup {
  db: DbConnection;
  deps: CommandResultSideEffectsDeps;
  environmentId: string;
  hostId: string;
}

function createTestMachineAuth(): MachineAuthService {
  return {
    buildJoinCommand: () => "bb host join test",
    disableMachineKey: async () => {
      throw new Error("Machine auth is not used in command-result owner tests");
    },
    ensureReady: async () => {},
    enrollHost: async () => {
      throw new Error("Machine auth is not used in command-result owner tests");
    },
    issueDaemonHostKey: async () => {
      throw new Error("Machine auth is not used in command-result owner tests");
    },
    issueHostEnrollKey: async () => {
      throw new Error("Machine auth is not used in command-result owner tests");
    },
    pruneExpiredKeys: async () => {},
    revokeHostEnrollKeys: async () => {
      throw new Error("Machine auth is not used in command-result owner tests");
    },
    rotateDaemonHostKey: async () => {
      throw new Error("Machine auth is not used in command-result owner tests");
    },
    verifyDaemonHostKey: async () => null,
  };
}

function setup(): TestCommandResultOwnerSetup {
  const db = createConnection(":memory:");
  migrate(db);

  const hub = new NotificationHub();
  const dataDir = join(tmpdir(), "bb-command-result-owners-test");
  const logger = createLogger({
    component: "command-result-owners-test",
    dataDir,
    transportMode: "stream",
  });
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
    workspaceProvisionType: "managed-worktree",
    status: "ready",
  });
  const pendingInteractions = new PendingInteractionLifecycle({
    db,
    hub,
    logger,
  });

  return {
    db,
    deps: {
      config: {
        appVersion: "test",
        dataDir,
        featureFlags: defaultFeatureFlags,
        hostDaemonPort: 1,
        inferenceModel: "test-model",
        isDevelopment: true,
        openAiApiKey: "",
        serverPort: 2,
        threadStorageRootPath: dataDir,
        transcriptionModel: "test-transcription-model",
      },
      db,
      hostLifecycle: createHostLifecycleService(),
      hub,
      lifecycleDedupers: createLifecycleDedupers(),
      logger,
      machineAuth: createTestMachineAuth(),
      pendingInteractions,
      terminalSessions: new TerminalSessionLifecycle({
        db,
        hub,
        logger,
      }),
    },
    environmentId: environment.id,
    hostId: host.id,
  };
}

function requireCommand(
  db: DbConnection,
  commandId: string,
): HostDaemonCommandRow {
  const command = getCommand(db, commandId);
  if (!command) {
    throw new Error(`Expected queued command ${commandId}`);
  }
  return command;
}

function handleOwnerReport(
  testSetup: TestCommandResultOwnerSetup,
  command: HostDaemonCommandRow,
  report: CommandResultSideEffectReport,
) {
  return testSetup.db.transaction(
    (tx) =>
      handleCommandResultSideEffects(
        {
          ...testSetup.deps,
          db: tx,
          hub: testSetup.deps.hub,
        },
        report,
        command,
      ),
    { behavior: "immediate" },
  );
}

describe("command-result owners", () => {
  it("settles environment destroy once and ignores duplicate terminal results", () => {
    const testSetup = setup();
    setEnvironmentStatus(
      testSetup.db,
      testSetup.deps.hub,
      testSetup.environmentId,
      {
        status: "destroying",
      },
    );
    const commandPayload = {
      type: "environment.destroy",
      environmentId: testSetup.environmentId,
      workspaceContext: {
        workspacePath: "/tmp/workspace",
        workspaceProvisionType: "managed-worktree",
      },
      cleanupSafety: {
        mode: "discard_archived",
      },
    };
    const command = queueCommand(testSetup.db, testSetup.deps.hub, {
      hostId: testSetup.hostId,
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

    const successReport: CommandResultSideEffectReport = {
      commandId: command.id,
      completedAt: 500,
      ok: true,
      result: {},
      type: "environment.destroy",
    };
    const sideEffects = handleOwnerReport(
      testSetup,
      requireCommand(testSetup.db, command.id),
      successReport,
    );

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

    const duplicateFailureReport: CommandResultSideEffectReport = {
      commandId: command.id,
      completedAt: 600,
      errorCode: "late_destroy_failure",
      errorMessage: "destroy failed late",
      ok: false,
      type: "environment.destroy",
    };
    handleOwnerReport(
      testSetup,
      requireCommand(testSetup.db, command.id),
      duplicateFailureReport,
    );

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
