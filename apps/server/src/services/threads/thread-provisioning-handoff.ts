import { getThreadOperation, type DbTransaction } from "@bb/db";
import { markThreadOperationRecordCompleted } from "@bb/db/internal-lifecycle";
import { isActiveLifecycleOperationState } from "@bb/domain";
import { appendThreadProvisioningEventInTransaction } from "./thread-events.js";
import { readThreadProvisioningIdFromPayload } from "./thread-provisioning-identity.js";

export interface CompleteThreadProvisioningForStartHandoffArgs {
  environmentId: string;
  threadId: string;
}

export function completeThreadProvisioningForStartHandoff(
  db: DbTransaction,
  args: CompleteThreadProvisioningForStartHandoffArgs,
): number | null {
  const operation = getThreadOperation(db, {
    threadId: args.threadId,
    kind: "provision",
  });
  if (!operation || !isActiveLifecycleOperationState(operation.state)) {
    return null;
  }
  const provisioningId = readThreadProvisioningIdFromPayload(operation.payload);

  const sequence = appendThreadProvisioningEventInTransaction(db, {
    threadId: args.threadId,
    environmentId: args.environmentId,
    provisioningId,
    status: "completed",
    entries: [],
  });
  markThreadOperationRecordCompleted(db, {
    threadId: args.threadId,
    kind: "provision",
  });
  return sequence;
}
