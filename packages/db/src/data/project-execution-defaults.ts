import { and, eq } from "drizzle-orm";
import type {
  ProjectExecutionDefaults,
  PermissionMode,
  ReasoningLevel,
  ServiceTier,
  ThreadType,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectExecutionDefaults } from "../schema.js";

export interface GetProjectExecutionDefaultsArgs {
  projectId: string;
  threadType: ThreadType;
}

export interface UpsertProjectExecutionDefaultsArgs extends GetProjectExecutionDefaultsArgs {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel;
  permissionMode: PermissionMode;
  serviceTier: ServiceTier;
  updatedAt?: number;
}

export function getProjectExecutionDefaults(
  db: DbConnection,
  args: GetProjectExecutionDefaultsArgs,
): ProjectExecutionDefaults | null {
  const row = db
    .select({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .from(projectExecutionDefaults)
    .where(
      and(
        eq(projectExecutionDefaults.projectId, args.projectId),
        eq(projectExecutionDefaults.threadType, args.threadType),
      ),
    )
    .get();

  return row ?? null;
}

export function upsertProjectExecutionDefaults(
  db: DbConnection,
  args: UpsertProjectExecutionDefaultsArgs,
): ProjectExecutionDefaults {
  const updatedAt = args.updatedAt ?? Date.now();
  const row = db
    .insert(projectExecutionDefaults)
    .values({
      projectId: args.projectId,
      providerId: args.providerId,
      threadType: args.threadType,
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      permissionMode: args.permissionMode,
      serviceTier: args.serviceTier,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        projectExecutionDefaults.projectId,
        projectExecutionDefaults.threadType,
      ],
      set: {
        providerId: args.providerId,
        model: args.model,
        reasoningLevel: args.reasoningLevel,
        permissionMode: args.permissionMode,
        serviceTier: args.serviceTier,
        updatedAt,
      },
    })
    .returning({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .get();

  return row;
}
