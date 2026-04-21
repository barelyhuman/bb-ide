import { and, eq, inArray } from "drizzle-orm";
import type {
  LifecycleOperationState,
  ThreadOperationKind,
  ThreadProvisioningState,
  ThreadProvisioningStage,
} from "@bb/domain";
import { createThreadOperationId } from "../ids.js";
import { threadOperations } from "../schema.js";
import {
  buildLifecycleOperationUpdateValues,
  buildRequestedLifecycleOperationValues,
  createLifecycleOperationRepository,
  getLifecycleOperationByCommandId,
  listLifecycleOperationRows,
  type LifecycleOperationReadConnection,
  type LifecycleOperationStore,
  type LifecycleOperationWriteConnection,
} from "./lifecycle-operation-helpers.js";

type ThreadOperationWriteConnection = LifecycleOperationWriteConnection;
type ThreadOperationReadConnection = LifecycleOperationReadConnection;

export type ThreadOperationRow = typeof threadOperations.$inferSelect;

export interface GetThreadOperationArgs {
  kind: ThreadOperationKind;
  threadId: string;
}

export interface UpsertThreadOperationInput {
  kind: ThreadOperationKind;
  payload: string;
  provisioningState?: ThreadProvisioningState | null;
  requestedAt?: number;
  threadId: string;
}

export interface UpdateThreadOperationStateArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId?: string | null;
  completedAt?: number | null;
  failureReason?: string | null;
  kind: ThreadOperationKind;
  payload?: string;
  provisioningState?: ThreadProvisioningState | null;
  queuedAt?: number | null;
  state: LifecycleOperationState;
  threadId: string;
}

export interface ListThreadOperationsArgs {
  kinds?: ThreadOperationKind[];
  states?: LifecycleOperationState[];
  threadIds?: string[];
}

interface ThreadOperationProvisioningStateColumns {
  provisionEventSequence?: number | null;
  provisioningEnvironmentId?: string | null;
  provisioningId?: string | null;
  provisioningStage?: ThreadProvisioningStage | null;
  workspaceReadyEventSequence?: number | null;
}

function threadOperationProvisioningStateColumns(
  state: ThreadProvisioningState | null | undefined,
): ThreadOperationProvisioningStateColumns {
  if (state === undefined) {
    return {};
  }
  if (state === null) {
    return {
      provisionEventSequence: null,
      provisioningEnvironmentId: null,
      provisioningId: null,
      provisioningStage: null,
      workspaceReadyEventSequence: null,
    };
  }
  return {
    provisionEventSequence: state.provisionEventSequence,
    provisioningEnvironmentId: state.environmentId,
    provisioningId: state.provisioningId,
    provisioningStage: state.stage,
    workspaceReadyEventSequence: state.workspaceReadyEventSequence,
  };
}

function getThreadOperationRecord(
  db: ThreadOperationReadConnection,
  args: GetThreadOperationArgs,
): ThreadOperationRow | null {
  return (
    db
      .select()
      .from(threadOperations)
      .where(
        and(
          eq(threadOperations.threadId, args.threadId),
          eq(threadOperations.kind, args.kind),
        ),
      )
      .get() ?? null
  );
}

function updateThreadOperationStateRecord(
  db: ThreadOperationWriteConnection,
  args: UpdateThreadOperationStateArgs,
): ThreadOperationRow | null {
  return (
    db
      .update(threadOperations)
      .set(
        buildLifecycleOperationUpdateValues({
          state: args.state,
          payload: args.payload,
          extraValues: threadOperationProvisioningStateColumns(
            args.provisioningState,
          ),
          commandId: args.commandId,
          queuedAt: args.queuedAt,
          completedAt: args.completedAt,
          failureReason: args.failureReason,
        }),
      )
      .where(
        and(
          eq(threadOperations.threadId, args.threadId),
          eq(threadOperations.kind, args.kind),
          args.allowedCurrentStates
            ? inArray(threadOperations.state, [...args.allowedCurrentStates])
            : undefined,
        ),
      )
      .returning()
      .get() ?? null
  );
}

const threadOperationStore: LifecycleOperationStore<
  ThreadOperationRow,
  GetThreadOperationArgs,
  ThreadOperationKind,
  UpsertThreadOperationInput
> = {
  get: getThreadOperationRecord,
  getIdentity: (input) => ({
    threadId: input.threadId,
    kind: input.kind,
  }),
  insertRequested: (db, args) =>
    db
      .insert(threadOperations)
      .values(
        buildRequestedLifecycleOperationValues({
          createId: createThreadOperationId,
          identity: {
            threadId: args.input.threadId,
          },
          input: args.input,
          extraValues: threadOperationProvisioningStateColumns(
            args.input.provisioningState ?? null,
          ),
          now: args.now,
          requestedAt: args.requestedAt,
        }),
      )
      .returning()
      .get(),
  updateState: (db, args) =>
    updateThreadOperationStateRecord(db, {
      threadId: args.identity.threadId,
      kind: args.identity.kind,
      allowedCurrentStates: args.allowedCurrentStates,
      payload: args.payload,
      provisioningState: args.requestedInput?.provisioningState,
      state: args.state,
      commandId: args.commandId,
      queuedAt: args.queuedAt,
      completedAt: args.completedAt,
      failureReason: args.failureReason,
    }),
};
const threadOperationRepository = createLifecycleOperationRepository(
  threadOperationStore,
);

export function getThreadOperation(
  db: ThreadOperationReadConnection,
  args: GetThreadOperationArgs,
): ThreadOperationRow | null {
  return getThreadOperationRecord(db, args);
}

export function listThreadOperations(
  db: ThreadOperationReadConnection,
  args: ListThreadOperationsArgs = {},
): ThreadOperationRow[] {
  const filters = [
    args.kinds && args.kinds.length > 0
      ? inArray(threadOperations.kind, args.kinds)
      : undefined,
    args.states && args.states.length > 0
      ? inArray(threadOperations.state, args.states)
      : undefined,
    args.threadIds && args.threadIds.length > 0
      ? inArray(threadOperations.threadId, args.threadIds)
      : undefined,
  ].filter((value) => value !== undefined);

  return listLifecycleOperationRows(
    db,
    threadOperations,
    filters.length > 0 ? and(...filters) : undefined,
  );
}

export function getThreadOperationByCommandId(
  db: ThreadOperationReadConnection,
  commandId: string,
): ThreadOperationRow | null {
  return getLifecycleOperationByCommandId(db, threadOperations, commandId);
}

export const upsertThreadOperationRecord = threadOperationRepository.upsert;

export const markThreadOperationRecordQueued =
  threadOperationRepository.markQueued;
export const markThreadOperationRecordCompleted =
  threadOperationRepository.markCompleted;
export const markThreadOperationRecordFailed =
  threadOperationRepository.markFailed;
export const cancelThreadOperationRecord = threadOperationRepository.cancel;
