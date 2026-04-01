import { describe, expect, it } from "vitest";
import { getThreadOutput, sendTextMessage } from "../../helpers/api.js";
import {
  waitForHostConnected,
  waitForHostDisconnected,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  createRecoveryThread,
  RECOVERY_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider idle crash recovery integration", () => {
  it("survives an ungraceful daemon crash and resumes idle work after restart", () =>
    withHarness(async (harness) => {
      const { thread } = await createRecoveryThread(
        harness,
        "Crash Recovery Idle",
      );

      await sendTextMessage(harness.api, thread.id, {
        text: "before crash restart",
      });
      await waitForThreadStatus(harness.api, thread.id, "idle", TURN_TIMEOUT_MS);

      await harness.crashDaemon();
      await waitForHostDisconnected(
        harness.api,
        harness.hostId,
        RECOVERY_TIMEOUT_MS,
      );

      await harness.startDaemon();
      await waitForHostConnected(harness.api, RECOVERY_TIMEOUT_MS);

      await sendTextMessage(harness.api, thread.id, {
        text: "after crash restart",
      });
      await waitForThreadStatus(harness.api, thread.id, "idle", TURN_TIMEOUT_MS);

      expect(await getThreadOutput(harness.api, thread.id)).toContain(
        "after crash restart",
      );
    }));
});
