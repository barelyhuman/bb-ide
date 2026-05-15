import { describe, expect, it } from "vitest";
import { getThreadEvents, sendTextMessage } from "../../helpers/api.js";
import {
  waitForHostConnected,
  waitForSuccessfulQueuedCommandsAfterCursor,
  waitForThreadOutputContaining,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  listQueuedCommandsForHostAfterCursor,
  readSessionRow,
} from "../../helpers/queries.js";
import {
  assertMonotonicSequences,
  createRecoveryThread,
  RECOVERY_TIMEOUT_MS,
  requireSessionId,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider session continuity integration", () => {
  it("preserves event sequencing and completes new commands across restart", () =>
    withHarness(async (harness) => {
      const { thread } = await createRecoveryThread(
        harness,
        "Restart Continuity",
      );

      await sendTextMessage(harness.api, thread.id, {
        text: "cursor first turn",
      });
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "cursor first turn",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );

      const commandsBefore = listQueuedCommandsForHostAfterCursor(harness.db, {
        cursor: 0,
        hostId: harness.hostId,
      });
      const eventsBefore = await getThreadEvents(harness.api, thread.id);
      const baselineCompletedCount = eventsBefore.filter(
        (event) => event.type === "turn/completed",
      ).length;
      expect(commandsBefore.length).toBeGreaterThan(0);
      const baselineCommandCursor = commandsBefore.at(-1)?.cursor ?? 0;

      await harness.restartDaemon("cursor-restart");
      await waitForHostConnected(harness.api, RECOVERY_TIMEOUT_MS);

      await sendTextMessage(harness.api, thread.id, {
        text: "cursor second turn",
      });
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "cursor second turn",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );

      // Thread events reach idle before the daemon's command-result POST settles.
      const newCommands = await waitForSuccessfulQueuedCommandsAfterCursor({
        cursor: baselineCommandCursor,
        db: harness.db,
        hostId: harness.hostId,
        minCount: 1,
        timeoutMs: TURN_TIMEOUT_MS,
      });
      const eventsAfter = await getThreadEvents(harness.api, thread.id);
      expect(newCommands.length).toBeGreaterThan(0);
      expect(
        newCommands.every(
          (command) =>
            command.state === "success" && command.completedAt !== null,
        ),
      ).toBe(true);
      expect(eventsAfter.length).toBeGreaterThan(eventsBefore.length);
      assertMonotonicSequences(eventsAfter);
      expect(
        eventsAfter.filter((event) => event.type === "turn/completed"),
      ).toHaveLength(baselineCompletedCount + 1);
    }));

  it("rejects late command results from an old session after restart", () =>
    withHarness(async (harness) => {
      const { thread } = await createRecoveryThread(
        harness,
        "Old Session Rejection",
      );
      const oldSessionId = requireSessionId(harness);

      await sendTextMessage(harness.api, thread.id, {
        text: "before session rotation",
      });
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "before session rotation",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );

      await harness.restartDaemon("old-session-restart");
      await waitForHostConnected(harness.api, RECOVERY_TIMEOUT_MS);

      const oldSession = readSessionRow(harness.db, oldSessionId);
      expect(oldSession?.status).toBe("closed");

      const staleResultResponse = await harness.internal.session[
        "command-result"
      ].$post({
        json: {
          commandId: "cmd_stale",
          completedAt: Date.now(),
          ok: true,
          result: {
            providerThreadId: "provider-stale",
          },
          sessionId: oldSessionId,
          type: "thread.start",
        },
      });
      expect(staleResultResponse.status).toBe(401);

      await sendTextMessage(harness.api, thread.id, {
        text: "after stale session rejection",
      });
      await waitForThreadOutputContaining(
        harness.api,
        thread.id,
        "after stale session rejection",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );
    }));
});
