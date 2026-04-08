import { and, eq } from "drizzle-orm";
import type {
  ReasoningLevel,
  ResolvedThreadExecutionOptions,
  SandboxMode,
  ServiceTier,
  ThreadExecutionSource,
} from "@bb/domain";
import type { DbConnection } from "../connection.js";
import { projectExecutionDefaults } from "../schema.js";

export interface GetProjectExecutionDefaultsArgs {
  projectId: string;
  providerId: string;
}

export interface UpsertProjectExecutionDefaultsArgs
  extends GetProjectExecutionDefaultsArgs {
  model: string;
  reasoningLevel: ReasoningLevel;
  sandboxMode: SandboxMode;
  serviceTier: ServiceTier;
  source: ThreadExecutionSource;
  updatedAt?: number;
}

export function getProjectExecutionDefaults(
  db: DbConnection,
  args: GetProjectExecutionDefaultsArgs,
): ResolvedThreadExecutionOptions | null {
  const row = db
    .select({
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      sandboxMode: projectExecutionDefaults.sandboxMode,
      serviceTier: projectExecutionDefaults.serviceTier,
      source: projectExecutionDefaults.source,
    })
    .from(projectExecutionDefaults)
    .where(
      and(
        eq(projectExecutionDefaults.projectId, args.projectId),
        eq(projectExecutionDefaults.providerId, args.providerId),
      ),
    )
    .get();

  return row ?? null;
}

export function upsertProjectExecutionDefaults(
  db: DbConnection,
  args: UpsertProjectExecutionDefaultsArgs,
): ResolvedThreadExecutionOptions {
  const updatedAt = args.updatedAt ?? Date.now();
  const row = db
    .insert(projectExecutionDefaults)
    .values({
      projectId: args.projectId,
      providerId: args.providerId,
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      sandboxMode: args.sandboxMode,
      serviceTier: args.serviceTier,
      source: args.source,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: [
        projectExecutionDefaults.projectId,
        projectExecutionDefaults.providerId,
      ],
      set: {
        model: args.model,
        reasoningLevel: args.reasoningLevel,
        sandboxMode: args.sandboxMode,
        serviceTier: args.serviceTier,
        source: args.source,
        updatedAt,
      },
    })
    .returning({
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      sandboxMode: projectExecutionDefaults.sandboxMode,
      serviceTier: projectExecutionDefaults.serviceTier,
      source: projectExecutionDefaults.source,
    })
    .get();

  return row;
}
