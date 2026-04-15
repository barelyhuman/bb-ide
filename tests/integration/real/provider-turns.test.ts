// Real provider turn lifecycle coverage.
import { describe, expect, it } from "vitest";
import { getThreadTimeline } from "../helpers/api.js";
import {
  countTurnEvents,
  createRealThread,
  expectNonEmptyOutput,
  hasAssistantTimelineMessage,
  REAL_PROVIDER_IDS,
  sendAndWaitForIdle,
  TEST_TIMEOUT_MS,
} from "./provider-smoke-harness.js";

describe("real provider turn integration", () => {
  for (const providerId of REAL_PROVIDER_IDS) {
    it.concurrent(
      `${providerId} completes a single turn end-to-end`,
      async () => {
        const { harness, thread } = await createRealThread({
          providerId,
          workspace: {
            path: null,
            type: "unmanaged",
          },
        });

        try {
          const { events, output } = await sendAndWaitForIdle({
            providerId,
            threadId: thread.id,
            text: "Reply with a short hello in one sentence.",
            harness,
          });

          expect(countTurnEvents(events, "turn/started")).toBeGreaterThanOrEqual(1);
          expect(countTurnEvents(events, "turn/completed")).toBeGreaterThanOrEqual(1);
          expectNonEmptyOutput(output, `${providerId} single-turn output`);

          const timeline = await getThreadTimeline(harness.api, thread.id);
          expect(hasAssistantTimelineMessage(timeline)).toBe(true);
        } finally {
          await harness.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );

    it.concurrent(
      `${providerId} handles a multi-turn thread end-to-end`,
      async () => {
        const { harness, thread } = await createRealThread({
          providerId,
          workspace: {
            path: null,
            type: "unmanaged",
          },
        });

        try {
          await sendAndWaitForIdle({
            providerId,
            threadId: thread.id,
            text: "Remember this word for later: orchard.",
            harness,
          });
          const { events, output } = await sendAndWaitForIdle({
            providerId,
            threadId: thread.id,
            text: "What word did I ask you to remember? Reply briefly.",
            harness,
          });

          expect(countTurnEvents(events, "turn/completed")).toBeGreaterThanOrEqual(2);
          expect(events.every((event) => event.threadId === thread.id)).toBe(true);
          expectNonEmptyOutput(output, `${providerId} multi-turn output`);
        } finally {
          await harness.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
});
