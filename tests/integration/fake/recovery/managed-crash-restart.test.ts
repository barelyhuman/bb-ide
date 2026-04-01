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

describe.sequential("fake provider managed crash recovery integration", () => {
  it("survives a crash with a managed-worktree environment and resumes after restart", () =>
    withHarness(async (harness) => {
      const { thread } = await createRecoveryThread(
        harness,
        "Managed Worktree Crash Restart",
        "managed-worktree",
      );

      await sendTextMessage(harness.api, thread.id, {
        text: "before managed crash",
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
        text: "after managed crash",
      });
      await waitForThreadStatus(harness.api, thread.id, "idle", TURN_TIMEOUT_MS);

      expect(await getThreadOutput(harness.api, thread.id)).toContain(
        "after managed crash",
      );
    }));
});
