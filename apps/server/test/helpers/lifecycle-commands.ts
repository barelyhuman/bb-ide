import { createEnvironmentProvisioningId, queueCommand } from "@bb/db";
import {
  markEnvironmentOperationRecordQueued,
  upsertEnvironmentOperationRecord,
} from "@bb/db/internal-environment-lifecycle";
import {
  markThreadOperationRecordQueued,
  upsertThreadOperationRecord,
} from "@bb/db/internal-lifecycle";
import type { EnvironmentOperationKind, ThreadOperationKind } from "@bb/domain";
import type { HostDaemonCommand } from "@bb/host-daemon-contract";
import { buildDirectEnvironmentProvisionRequest } from "../../src/services/environments/environment-provision-request.js";
import type { TestAppHarness } from "./test-app.js";

type EnvironmentDestroyCommand = Extract<
  HostDaemonCommand,
  { type: "environment.destroy" }
>;
type EnvironmentProvisionCommand = Extract<
  HostDaemonCommand,
  { type: "environment.provision" }
>;
type ThreadStartCommand = Extract<HostDaemonCommand, { type: "thread.start" }>;
type ThreadStopCommand = Extract<HostDaemonCommand, { type: "thread.stop" }>;

interface QueueEnvironmentLifecycleCommandArgs {
  command: EnvironmentDestroyCommand | EnvironmentProvisionCommand;
  environmentId: string;
  hostId: string;
  kind: Extract<
    EnvironmentOperationKind,
    "destroy" | "provision" | "reprovision"
  >;
  operationPayload: string;
  sessionId: string | null;
}

interface QueueThreadLifecycleCommandArgs {
  command: ThreadStartCommand | ThreadStopCommand;
  hostId: string;
  kind: ThreadOperationKind;
  sessionId: string | null;
  threadId: string;
}

function queueEnvironmentLifecycleCommand(
  harness: TestAppHarness,
  args: QueueEnvironmentLifecycleCommandArgs,
) {
  const queued = queueCommand(harness.db, harness.hub, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    type: args.command.type,
    payload: JSON.stringify(args.command),
  });

  upsertEnvironmentOperationRecord(harness.db, {
    environmentId: args.environmentId,
    kind: args.kind,
    payload: args.operationPayload,
  });
  markEnvironmentOperationRecordQueued(harness.db, {
    environmentId: args.environmentId,
    kind: args.kind,
    commandId: queued.id,
  });

  return queued;
}

function queueThreadLifecycleCommand(
  harness: TestAppHarness,
  args: QueueThreadLifecycleCommandArgs,
) {
  const queued = queueCommand(harness.db, harness.hub, {
    hostId: args.hostId,
    sessionId: args.sessionId,
    type: args.command.type,
    payload: JSON.stringify(args.command),
  });

  upsertThreadOperationRecord(harness.db, {
    threadId: args.threadId,
    kind: args.kind,
    payload: JSON.stringify(args.command),
  });
  markThreadOperationRecordQueued(harness.db, {
    threadId: args.threadId,
    kind: args.kind,
    commandId: queued.id,
  });

  return queued;
}

export function queueEnvironmentProvisionLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<
    QueueEnvironmentLifecycleCommandArgs,
    "kind" | "operationPayload"
  > & {
    command: EnvironmentProvisionCommand;
    kind?: Extract<EnvironmentOperationKind, "provision" | "reprovision">;
  },
) {
  return queueEnvironmentLifecycleCommand(harness, {
    ...args,
    kind: args.kind ?? "provision",
    operationPayload: JSON.stringify(
      buildDirectEnvironmentProvisionRequest({
        command: args.command,
        provisioningId:
          args.command.initiator?.provisioningId ??
          createEnvironmentProvisioningId(),
      }),
    ),
  });
}

export function queueEnvironmentDestroyLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<
    QueueEnvironmentLifecycleCommandArgs,
    "kind" | "operationPayload"
  > & {
    command: EnvironmentDestroyCommand;
  },
) {
  return queueEnvironmentLifecycleCommand(harness, {
    ...args,
    kind: "destroy",
    operationPayload: JSON.stringify(args.command),
  });
}

export function queueThreadStartLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<QueueThreadLifecycleCommandArgs, "kind"> & {
    command: ThreadStartCommand;
  },
) {
  return queueThreadLifecycleCommand(harness, {
    ...args,
    kind: "start",
  });
}

export function queueThreadStopLifecycleCommand(
  harness: TestAppHarness,
  args: Omit<QueueThreadLifecycleCommandArgs, "kind"> & {
    command: ThreadStopCommand;
  },
) {
  return queueThreadLifecycleCommand(harness, {
    ...args,
    kind: "stop",
  });
}
