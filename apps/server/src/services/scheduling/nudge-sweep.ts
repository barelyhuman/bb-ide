import {
  type DueManagerThreadNudgeCursor,
  listDueManagerThreadNudges,
} from "@bb/db";
import type { AppDeps } from "../../types.js";
import {
  createNudgeSweepCache,
  DUE_NUDGE_BATCH_SIZE,
  resetNudgeSweepBatchCache,
  runDueNudge,
  toDueManagerThreadNudgeCursor,
} from "./nudge-sweep-runner.js";

interface SweepDueNudgesArgs {
  now?: number;
}

function nextDueNudgeCursor(
  dueNudges: ReturnType<typeof listDueManagerThreadNudges>,
): DueManagerThreadNudgeCursor | undefined {
  const lastNudge = dueNudges[dueNudges.length - 1];
  return lastNudge ? toDueManagerThreadNudgeCursor(lastNudge) : undefined;
}

export async function sweepDueNudges(
  deps: Pick<AppDeps, "db" | "hub" | "logger">,
  args: SweepDueNudgesArgs = {},
): Promise<void> {
  const now = args.now ?? Date.now();
  const cache = createNudgeSweepCache();
  let after: DueManagerThreadNudgeCursor | undefined;

  while (true) {
    const dueNudges = listDueManagerThreadNudges(deps.db, {
      now,
      after,
      limit: DUE_NUDGE_BATCH_SIZE,
    });
    for (const nudge of dueNudges) {
      try {
        await runDueNudge(deps, cache, nudge, now);
      } catch (error) {
        deps.logger.error(
          {
            err: error,
            nudgeId: nudge.id,
            threadId: nudge.threadId,
          },
          "Failed to process a due manager nudge",
        );
      }
    }
    if (dueNudges.length < DUE_NUDGE_BATCH_SIZE) {
      return;
    }
    after = nextDueNudgeCursor(dueNudges);
    resetNudgeSweepBatchCache(cache);
  }
}
