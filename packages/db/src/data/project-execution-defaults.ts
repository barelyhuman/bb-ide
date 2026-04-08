import { and, eq } from "drizzle-orm";
import type {
  ProjectExecutionDefaults,
  ReasoningLevel,
  SandboxMode,
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
  sandboxMode: SandboxMode;
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
      sandboxMode: projectExecutionDefaults.sandboxMode,
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
      sandboxMode: args.sandboxMode,
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
        sandboxMode: args.sandboxMode,
        serviceTier: args.serviceTier,
        updatedAt,
      },
    })
    .returning({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      sandboxMode: projectExecutionDefaults.sandboxMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .get();

  return row;
}
