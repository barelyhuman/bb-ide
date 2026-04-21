import { and, eq, inArray } from "drizzle-orm";
import type {
  EnvironmentOperationKind,
  LifecycleOperationState,
} from "@bb/domain";
import { createEnvironmentOperationId } from "../ids.js";
import { environmentOperations } from "../schema.js";
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

type EnvironmentOperationWriteConnection = LifecycleOperationWriteConnection;
type EnvironmentOperationReadConnection = LifecycleOperationReadConnection;

export type EnvironmentOperationRow = typeof environmentOperations.$inferSelect;

export interface GetEnvironmentOperationArgs {
  environmentId: string;
  kind: EnvironmentOperationKind;
}

export interface UpsertEnvironmentOperationInput {
  environmentId: string;
  kind: EnvironmentOperationKind;
  payload: string;
  requestedAt?: number;
}

export interface UpdateEnvironmentOperationStateArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  completedAt?: number | null;
  commandId?: string | null;
  environmentId: string;
  failureReason?: string | null;
  kind: EnvironmentOperationKind;
  payload?: string;
  queuedAt?: number | null;
  state: LifecycleOperationState;
}

export interface ListEnvironmentOperationsArgs {
  environmentIds?: string[];
  kinds?: EnvironmentOperationKind[];
  states?: LifecycleOperationState[];
}

function getEnvironmentOperationRecord(
  db: EnvironmentOperationReadConnection,
  args: GetEnvironmentOperationArgs,
): EnvironmentOperationRow | null {
  return (
    db
      .select()
      .from(environmentOperations)
      .where(
        and(
          eq(environmentOperations.environmentId, args.environmentId),
          eq(environmentOperations.kind, args.kind),
        ),
      )
      .get() ?? null
  );
}

function updateEnvironmentOperationStateRecord(
  db: EnvironmentOperationWriteConnection,
  args: UpdateEnvironmentOperationStateArgs,
): EnvironmentOperationRow | null {
  return (
    db
      .update(environmentOperations)
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
          eq(environmentOperations.environmentId, args.environmentId),
          eq(environmentOperations.kind, args.kind),
          args.allowedCurrentStates
            ? inArray(environmentOperations.state, [
                ...args.allowedCurrentStates,
              ])
            : undefined,
        ),
      )
      .returning()
      .get() ?? null
  );
}

const environmentOperationStore: LifecycleOperationStore<
  EnvironmentOperationRow,
  GetEnvironmentOperationArgs,
  EnvironmentOperationKind,
  UpsertEnvironmentOperationInput
> = {
  get: getEnvironmentOperationRecord,
  getIdentity: (input) => ({
    environmentId: input.environmentId,
    kind: input.kind,
  }),
  insertRequested: (db, args) =>
    db
      .insert(environmentOperations)
      .values(
        buildRequestedLifecycleOperationValues({
          createId: createEnvironmentOperationId,
          identity: {
            environmentId: args.input.environmentId,
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
    updateEnvironmentOperationStateRecord(db, {
      environmentId: args.identity.environmentId,
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
const environmentOperationRepository = createLifecycleOperationRepository(
  environmentOperationStore,
);

export function getEnvironmentOperation(
  db: EnvironmentOperationReadConnection,
  args: GetEnvironmentOperationArgs,
): EnvironmentOperationRow | null {
  return getEnvironmentOperationRecord(db, args);
}

export function listEnvironmentOperations(
  db: EnvironmentOperationReadConnection,
  args: ListEnvironmentOperationsArgs = {},
): EnvironmentOperationRow[] {
  const filters = [
    args.environmentIds && args.environmentIds.length > 0
      ? inArray(environmentOperations.environmentId, args.environmentIds)
      : undefined,
    args.kinds && args.kinds.length > 0
      ? inArray(environmentOperations.kind, args.kinds)
      : undefined,
    args.states && args.states.length > 0
      ? inArray(environmentOperations.state, args.states)
      : undefined,
  ].filter((value) => value !== undefined);

  return listLifecycleOperationRows(
    db,
    environmentOperations,
    filters.length > 0 ? and(...filters) : undefined,
  );
}

export function getEnvironmentOperationByCommandId(
  db: EnvironmentOperationReadConnection,
  commandId: string,
): EnvironmentOperationRow | null {
  return getLifecycleOperationByCommandId(db, environmentOperations, commandId);
}

export const upsertEnvironmentOperationRecord =
  environmentOperationRepository.upsert;
export const markEnvironmentOperationRecordQueued =
  environmentOperationRepository.markQueued;
export const markEnvironmentOperationRecordCompleted =
  environmentOperationRepository.markCompleted;
export const markEnvironmentOperationRecordFailed =
  environmentOperationRepository.markFailed;
export const cancelEnvironmentOperationRecord =
  environmentOperationRepository.cancel;
