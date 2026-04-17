import {
  activeLifecycleOperationStates,
  type LifecycleOperationState,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";

export type LifecycleOperationReadConnection = DbConnection | DbTransaction;
export type LifecycleOperationWriteConnection = DbConnection | DbTransaction;

export interface LifecycleOperationRecordBase<TKind> {
  commandId: string | null;
  completedAt: number | null;
  failureReason: string | null;
  kind: TKind;
  payload: string;
  queuedAt: number | null;
  requestedAt: number;
  state: LifecycleOperationState;
}

export interface LifecycleOperationUpsertInput<TKind> {
  kind: TKind;
  payload: string;
  requestedAt?: number;
}

export interface InsertRequestedLifecycleOperationArgs<TUpsertInput> {
  input: TUpsertInput;
  now: number;
  requestedAt: number;
}

export interface UpdateLifecycleOperationRecordArgs<TIdentityArgs> {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId?: string | null;
  completedAt?: number | null;
  failureReason?: string | null;
  identity: TIdentityArgs;
  payload?: string;
  queuedAt?: number | null;
  state: LifecycleOperationState;
}

export interface LifecycleOperationStore<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
> {
  get(
    db: LifecycleOperationReadConnection,
    identity: TIdentityArgs,
  ): TRow | null;
  getIdentity(input: TUpsertInput): TIdentityArgs;
  insertRequested(
    db: LifecycleOperationWriteConnection,
    args: InsertRequestedLifecycleOperationArgs<TUpsertInput>,
  ): TRow;
  updateState(
    db: LifecycleOperationWriteConnection,
    args: UpdateLifecycleOperationRecordArgs<TIdentityArgs>,
  ): TRow | null;
}

export interface QueueLifecycleOperationArgs<TIdentityArgs> {
  commandId: string;
  identity: TIdentityArgs;
  queuedAt?: number;
}

export interface CompleteLifecycleOperationArgs<TIdentityArgs> {
  completedAt?: number;
  identity: TIdentityArgs;
}

export interface FailLifecycleOperationArgs<TIdentityArgs> {
  completedAt?: number;
  failureReason: string;
  identity: TIdentityArgs;
}

export function upsertLifecycleOperationRecord<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  input: TUpsertInput,
): TRow {
  const now = Date.now();
  const requestedAt = input.requestedAt ?? now;
  const identity = store.getIdentity(input);
  const existing = store.get(db, identity);

  if (existing) {
    return (
      store.updateState(db, {
        identity,
        payload: input.payload,
        state: "requested",
        commandId: null,
        queuedAt: null,
        completedAt: null,
        failureReason: null,
      }) ?? existing
    );
  }

  return store.insertRequested(db, {
    input,
    now,
    requestedAt,
  });
}

export function markLifecycleOperationQueued<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: QueueLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  return store.updateState(db, {
    identity: args.identity,
    state: "queued",
    commandId: args.commandId,
    queuedAt: args.queuedAt ?? Date.now(),
    completedAt: null,
    failureReason: null,
    allowedCurrentStates: ["requested"],
  });
}

export function markLifecycleOperationFetched<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  identity: TIdentityArgs,
): TRow | null {
  const existing = store.get(db, identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity,
    payload: existing.payload,
    state: "fetched",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: null,
    failureReason: null,
    allowedCurrentStates: ["queued"],
  });
}

export function markLifecycleOperationCompleted<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: CompleteLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  const existing = store.get(db, args.identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity: args.identity,
    payload: existing.payload,
    state: "completed",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: args.completedAt ?? Date.now(),
    failureReason: null,
    allowedCurrentStates: activeLifecycleOperationStates,
  });
}

export function markLifecycleOperationFailed<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: FailLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  const existing = store.get(db, args.identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity: args.identity,
    payload: existing.payload,
    state: "failed",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: args.completedAt ?? Date.now(),
    failureReason: args.failureReason,
    allowedCurrentStates: activeLifecycleOperationStates,
  });
}

export function cancelLifecycleOperationRecord<
  TRow extends LifecycleOperationRecordBase<TKind>,
  TIdentityArgs,
  TKind,
  TUpsertInput extends LifecycleOperationUpsertInput<TKind>,
>(
  db: LifecycleOperationWriteConnection,
  store: LifecycleOperationStore<TRow, TIdentityArgs, TKind, TUpsertInput>,
  args: CompleteLifecycleOperationArgs<TIdentityArgs>,
): TRow | null {
  const existing = store.get(db, args.identity);
  if (!existing) {
    return null;
  }

  return store.updateState(db, {
    identity: args.identity,
    payload: existing.payload,
    state: "cancelled",
    commandId: existing.commandId,
    queuedAt: existing.queuedAt,
    completedAt: args.completedAt ?? Date.now(),
    failureReason: null,
    allowedCurrentStates: activeLifecycleOperationStates,
  });
}
