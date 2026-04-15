// Real provider active-turn control coverage.
import { describe, expect, it } from "vitest";
import {
  getThread,
  getThreadEvents,
  sendTextMessage,
  stopThread,
} from "../helpers/api.js";
import { waitForThreadStatus } from "../helpers/assertions.js";
import {
  countTurnEvents,
  createRealThread,
  expectNonEmptyOutput,
  getExecutionOptions,
  REAL_PROVIDER_IDS,
  sendAndWaitForIdle,
  sendLongRunningTurnAndWaitStarted,
  STOP_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  waitForUserMessageAckTextAfter,
} from "./provider-smoke-harness.js";

describe("real provider control integration", () => {
  for (const providerId of REAL_PROVIDER_IDS) {
    it.concurrent(
      `${providerId} can steer an active turn`,
      async () => {
        const { harness, thread } = await createRealThread({
          providerId,
          workspace: {
            path: null,
            type: "unmanaged",
          },
        });

        try {
          await sendLongRunningTurnAndWaitStarted({
            providerId,
            harness,
            threadId: thread.id,
          });
          const steerBaselineEvents = await getThreadEvents(harness.api, thread.id);
          const steerBaselineSequence = Math.max(
            0,
            ...steerBaselineEvents.map((event) => event.seq),
          );
          const steerText = `Steer acknowledgement ${providerId}`;
          await sendTextMessage(harness.api, thread.id, {
            execution: getExecutionOptions(providerId),
            mode: "steer",
            text: steerText,
          });
          await waitForUserMessageAckTextAfter({
            baselineSequence: steerBaselineSequence,
            harness,
            text: steerText,
            threadId: thread.id,
          });

          const refreshedThread = await getThread(harness.api, thread.id);
          if (refreshedThread.status === "active") {
            await stopThread(harness.api, thread.id);
            await waitForThreadStatus(
              harness.api,
              thread.id,
              "idle",
              STOP_TIMEOUT_MS,
            );
          }
        } finally {
          await harness.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );

    it.concurrent(
      `${providerId} can stop an active turn and recover`,
      async () => {
        const { harness, thread } = await createRealThread({
          providerId,
          workspace: {
            path: null,
            type: "unmanaged",
          },
        });

        try {
          await sendLongRunningTurnAndWaitStarted({
            providerId,
            harness,
            threadId: thread.id,
          });

          await stopThread(harness.api, thread.id);
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            STOP_TIMEOUT_MS,
          );

          const beforeRecoveryEvents = await getThreadEvents(harness.api, thread.id);
          const { events, output } = await sendAndWaitForIdle({
            providerId,
            threadId: thread.id,
            text: "Reply with a short confirmation that you are ready for the next task.",
            harness,
          });
          expect(countTurnEvents(events, "turn/completed")).toBeGreaterThan(
            countTurnEvents(beforeRecoveryEvents, "turn/completed"),
          );
          expectNonEmptyOutput(output, `${providerId} recovery output`);
        } finally {
          await harness.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  }
});
