import { and, eq, inArray } from "drizzle-orm";
import type { LifecycleOperationState, ProjectOperationKind } from "@bb/domain";
import { createProjectOperationId } from "../ids.js";
import { projectOperations } from "../schema.js";
import {
  buildLifecycleOperationUpdateValues,
  buildRequestedLifecycleOperationValues,
  createLifecycleOperationRepository,
  listLifecycleOperationRows,
  type LifecycleOperationReadConnection,
  type LifecycleOperationStore,
  type LifecycleOperationWriteConnection,
} from "./lifecycle-operation-helpers.js";

type ProjectOperationWriteConnection = LifecycleOperationWriteConnection;
type ProjectOperationReadConnection = LifecycleOperationReadConnection;

export type ProjectOperationRow = typeof projectOperations.$inferSelect;

export interface GetProjectOperationArgs {
  kind: ProjectOperationKind;
  projectId: string;
}

export interface UpsertProjectOperationInput {
  kind: ProjectOperationKind;
  payload: string;
  projectId: string;
  requestedAt?: number;
}

export interface UpdateProjectOperationStateArgs {
  allowedCurrentStates?: readonly LifecycleOperationState[];
  commandId?: string | null;
  completedAt?: number | null;
  failureReason?: string | null;
  kind: ProjectOperationKind;
  payload?: string;
  projectId: string;
  queuedAt?: number | null;
  state: LifecycleOperationState;
}

export interface ListProjectOperationsArgs {
  kind?: ProjectOperationKind;
  projectIds?: string[];
  states?: LifecycleOperationState[];
}

function getProjectOperationRecord(
  db: ProjectOperationReadConnection,
  args: GetProjectOperationArgs,
): ProjectOperationRow | null {
  return (
    db
      .select()
      .from(projectOperations)
      .where(
        and(
          eq(projectOperations.projectId, args.projectId),
          eq(projectOperations.kind, args.kind),
        ),
      )
      .get() ?? null
  );
}

function updateProjectOperationStateRecord(
  db: ProjectOperationWriteConnection,
  args: UpdateProjectOperationStateArgs,
): ProjectOperationRow | null {
  return (
    db
      .update(projectOperations)
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
          eq(projectOperations.projectId, args.projectId),
          eq(projectOperations.kind, args.kind),
          args.allowedCurrentStates
            ? inArray(projectOperations.state, [...args.allowedCurrentStates])
            : undefined,
        ),
      )
      .returning()
      .get() ?? null
  );
}

const projectOperationStore: LifecycleOperationStore<
  ProjectOperationRow,
  GetProjectOperationArgs,
  ProjectOperationKind,
  UpsertProjectOperationInput
> = {
  get: getProjectOperationRecord,
  getIdentity: (input) => ({
    projectId: input.projectId,
    kind: input.kind,
  }),
  insertRequested: (db, args) =>
    db
      .insert(projectOperations)
      .values(
        buildRequestedLifecycleOperationValues({
          createId: createProjectOperationId,
          identity: {
            projectId: args.input.projectId,
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
    updateProjectOperationStateRecord(db, {
      projectId: args.identity.projectId,
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
const projectOperationRepository = createLifecycleOperationRepository(
  projectOperationStore,
);

export function getProjectOperation(
  db: ProjectOperationReadConnection,
  args: GetProjectOperationArgs,
): ProjectOperationRow | null {
  return getProjectOperationRecord(db, args);
}

export function listProjectOperations(
  db: ProjectOperationReadConnection,
  args: ListProjectOperationsArgs = {},
): ProjectOperationRow[] {
  const filters = [
    args.kind ? eq(projectOperations.kind, args.kind) : undefined,
    args.projectIds && args.projectIds.length > 0
      ? inArray(projectOperations.projectId, args.projectIds)
      : undefined,
    args.states && args.states.length > 0
      ? inArray(projectOperations.state, args.states)
      : undefined,
  ].filter((value) => value !== undefined);

  return listLifecycleOperationRows(
    db,
    projectOperations,
    filters.length > 0 ? and(...filters) : undefined,
  );
}

export const upsertProjectOperationRecord = projectOperationRepository.upsert;
export const markProjectOperationRecordQueued =
  projectOperationRepository.markQueued;
export const markProjectOperationRecordCompleted =
  projectOperationRepository.markCompleted;
export const markProjectOperationRecordFailed =
  projectOperationRepository.markFailed;
export const cancelProjectOperationRecord = projectOperationRepository.cancel;
