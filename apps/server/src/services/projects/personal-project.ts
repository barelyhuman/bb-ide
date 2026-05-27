import {
  ensurePersonalProject,
  getProjectExecutionDefaults,
  upsertProjectExecutionDefaults,
} from "@bb/db";
import { PERSONAL_PROJECT_ID, threadTypeValues } from "@bb/domain";
import type { DbConnection } from "@bb/db";
import { buildInitialProjectExecutionDefaults } from "../threads/thread-default-policy.js";

export function ensurePersonalProjectBootstrap(db: DbConnection): void {
  ensurePersonalProject(db);

  for (const threadType of threadTypeValues) {
    const existingDefaults = getProjectExecutionDefaults(db, {
      projectId: PERSONAL_PROJECT_ID,
      threadType,
    });
    if (existingDefaults) {
      continue;
    }

    upsertProjectExecutionDefaults(db, {
      projectId: PERSONAL_PROJECT_ID,
      threadType,
      ...buildInitialProjectExecutionDefaults(threadType),
    });
  }
}
