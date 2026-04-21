import { and, eq, inArray } from "drizzle-orm";
import type { HostOperationKind, LifecycleOperationState } from "@bb/domain";
import { createHostOperationId } from "../ids.js";
import { hostOperations } from "../schema.js";
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

type HostOperationWriteConnection = LifecycleOperationWriteConnection;
type HostOperationReadConnection = LifecycleOperationReadConnection;

export type HostOperationRow = typeof hostOperations.$inferSelect;

export interface GetHostOperationArgs {
  hostId: string;
  kind: HostOperationKind;
}

export interface UpsertHostOperationInput {
  hostId: string;
  kind: HostOperationKind;
  payload: string;
  requestedAt?: number;
}

export interface UpdateHostOperationStateArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId?: string | null;
  completedAt?: number | null;
  failureReason?: string | null;
  hostId: string;
  kind: HostOperationKind;
  payload?: string;
  queuedAt?: number | null;
  state: LifecycleOperationState;
}

export interface ResetHostOperationToRequestedArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  hostId: string;
  kind: HostOperationKind;
  payload: string;
}

export interface MarkHostOperationRecordCompletedWithPayloadArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId: string | null;
  completedAt: number;
  hostId: string;
  kind: HostOperationKind;
  payload: string;
  queuedAt: number | null;
}

export interface ListHostOperationsArgs {
  hostIds?: string[];
  kinds?: HostOperationKind[];
  states?: LifecycleOperationState[];
}

function getHostOperationRecord(
  db: HostOperationReadConnection,
  args: GetHostOperationArgs,
): HostOperationRow | null {
  return (
    db
      .select()
      .from(hostOperations)
      .where(
        and(
          eq(hostOperations.hostId, args.hostId),
          eq(hostOperations.kind, args.kind),
        ),
      )
      .get() ?? null
  );
}

function updateHostOperationStateRecord(
  db: HostOperationWriteConnection,
  args: UpdateHostOperationStateArgs,
): HostOperationRow | null {
  return (
    db
      .update(hostOperations)
      .set(
        buildLifecycleOperationUpdateValues({
          state: args.state,
          payload: args.payload,
          extraValues: {},
          commandId: args.commandId,
          queuedAt: args.queuedAt,
          completedAt: args.completedAt,
          failureReason: args.failureReason,
        }),
      )
      .where(
        and(
          eq(hostOperations.hostId, args.hostId),
          eq(hostOperations.kind, args.kind),
          args.allowedCurrentStates
            ? inArray(hostOperations.state, [...args.allowedCurrentStates])
            : undefined,
        ),
      )
      .returning()
      .get() ?? null
  );
}

const hostOperationStore: LifecycleOperationStore<
  HostOperationRow,
  GetHostOperationArgs,
  HostOperationKind,
  UpsertHostOperationInput
> = {
  get: getHostOperationRecord,
  getIdentity: (input) => ({
    hostId: input.hostId,
    kind: input.kind,
  }),
  insertRequested: (db, args) =>
    db
      .insert(hostOperations)
      .values(
        buildRequestedLifecycleOperationValues({
          createId: createHostOperationId,
          identity: {
            hostId: args.input.hostId,
          },
          input: args.input,
          extraValues: {},
          now: args.now,
          requestedAt: args.requestedAt,
        }),
      )
      .returning()
      .get(),
  updateState: (db, args) =>
    updateHostOperationStateRecord(db, {
      hostId: args.identity.hostId,
      kind: args.identity.kind,
      allowedCurrentStates: args.allowedCurrentStates,
      payload: args.payload,
      state: args.state,
      commandId: args.commandId,
      queuedAt: args.queuedAt,
      completedAt: args.completedAt,
      failureReason: args.failureReason,
    }),
};
const hostOperationRepository = createLifecycleOperationRepository(
  hostOperationStore,
);

export function getHostOperation(
  db: HostOperationReadConnection,
  args: GetHostOperationArgs,
): HostOperationRow | null {
  return getHostOperationRecord(db, args);
}

export function listHostOperations(
  db: HostOperationReadConnection,
  args: ListHostOperationsArgs = {},
): HostOperationRow[] {
  const filters = [
    args.hostIds && args.hostIds.length > 0
      ? inArray(hostOperations.hostId, args.hostIds)
      : undefined,
    args.kinds && args.kinds.length > 0
      ? inArray(hostOperations.kind, args.kinds)
      : undefined,
    args.states && args.states.length > 0
      ? inArray(hostOperations.state, args.states)
      : undefined,
  ].filter((value) => value !== undefined);

  return listLifecycleOperationRows(
    db,
    hostOperations,
    filters.length > 0 ? and(...filters) : undefined,
  );
}

export function getHostOperationByCommandId(
  db: HostOperationReadConnection,
  commandId: string,
): HostOperationRow | null {
  return getLifecycleOperationByCommandId(db, hostOperations, commandId);
}

export const upsertHostOperationRecord = hostOperationRepository.upsert;

export function resetHostOperationRecordToRequested(
  db: HostOperationWriteConnection,
  args: ResetHostOperationToRequestedArgs,
): HostOperationRow | null {
  return updateHostOperationStateRecord(db, {
    hostId: args.hostId,
    kind: args.kind,
    allowedCurrentStates: args.allowedCurrentStates,
    commandId: null,
    completedAt: null,
    failureReason: null,
    payload: args.payload,
    queuedAt: null,
    state: "requested",
  });
}

export function markHostOperationRecordCompletedWithPayload(
  db: HostOperationWriteConnection,
  args: MarkHostOperationRecordCompletedWithPayloadArgs,
): HostOperationRow | null {
  return updateHostOperationStateRecord(db, {
    hostId: args.hostId,
    kind: args.kind,
    allowedCurrentStates: args.allowedCurrentStates,
    commandId: args.commandId,
    completedAt: args.completedAt,
    failureReason: null,
    payload: args.payload,
    queuedAt: args.queuedAt,
    state: "completed",
  });
}

export const markHostOperationRecordQueued =
  hostOperationRepository.markQueued;
export const markHostOperationRecordCompleted =
  hostOperationRepository.markCompleted;
export const markHostOperationRecordFailed =
  hostOperationRepository.markFailed;
export const cancelHostOperationRecord = hostOperationRepository.cancel;
