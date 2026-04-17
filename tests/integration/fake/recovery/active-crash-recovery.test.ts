import { describe, expect, it } from "vitest";
import {
  getThreadEvents,
  getThreadOutput,
  sendTextMessage,
} from "../../helpers/api.js";
import {
  waitForHostConnected,
  waitForHostDisconnected,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  ACTIVE_TIMEOUT_MS,
  createRecoveryThread,
  RECOVERY_TIMEOUT_MS,
  STOP_DELAY_TEXT,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider active crash recovery integration", () => {
  it("moves an active thread to error on crash and allows a new turn after restart", () =>
    withHarness(async (harness) => {
      const { thread } = await createRecoveryThread(
        harness,
        "Crash Recovery Active",
      );

      await sendTextMessage(harness.api, thread.id, {
        text: STOP_DELAY_TEXT,
      });
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "active",
        ACTIVE_TIMEOUT_MS,
      );

      await harness.crashDaemon();
      await waitForHostDisconnected(
        harness.api,
        harness.hostId,
        RECOVERY_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "error",
        RECOVERY_TIMEOUT_MS,
      );

      await harness.startDaemon();
      await waitForHostConnected(harness.api, RECOVERY_TIMEOUT_MS);

      await sendTextMessage(harness.api, thread.id, {
        text: "recovered after crash",
      });
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );

      const events = await getThreadEvents(harness.api, thread.id);
      expect(
        events.some(
          (event) =>
            event.type === "system/error" &&
            event.data.code === "host_daemon_disconnected",
        ),
      ).toBe(true);
      expect(await getThreadOutput(harness.api, thread.id)).toContain(
        "recovered after crash",
      );
    }));
});
