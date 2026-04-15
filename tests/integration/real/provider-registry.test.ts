// Real provider registry-path coverage.
import { describe, expect, it } from "vitest";
import {
  countTurnEvents,
  createRealThread,
  expectNonEmptyOutput,
  REAL_PROVIDER_IDS,
  sendAndWaitForIdle,
  TEST_TIMEOUT_MS,
} from "./provider-smoke-harness.js";

describe("real provider registry integration", () => {
  for (const providerId of REAL_PROVIDER_IDS) {
    it.concurrent(
      `${providerId} runs through the registered provider path`,
      async () => {
        const { harness, thread } = await createRealThread({
          providerId,
          workspace: {
            type: "managed-worktree",
          },
        });

        try {
          const { events, output } = await sendAndWaitForIdle({
            providerId,
            threadId: thread.id,
            text: "Reply with a short confirmation that the thread is working.",
            harness,
          });

          expect(countTurnEvents(events, "turn/completed")).toBeGreaterThanOrEqual(1);
          expectNonEmptyOutput(output, `${providerId} registry output`);
        } finally {
          await harness.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
});
