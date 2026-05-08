import { getThreadEventScopeTurnId } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { getThreadEvents, sendTextMessage } from "../../helpers/api.js";
import {
  waitForEventType,
  waitForThreadStatus,
} from "../../helpers/assertions.js";
import { withHarness } from "../../helpers/harness.js";
import {
  createProjectFixture,
  createReadyThread,
  TURN_TIMEOUT_MS,
} from "./shared.js";

describe.sequential("fake provider tool-call integration", () => {
  it("resolves unresolved provider turn ids before dynamic tool calls reach the server", () =>
    withHarness(async (harness) => {
      const project = await createProjectFixture(
        harness,
        "Tool Call Turn Repair",
      );
      const { thread } = await createReadyThread(harness, {
        projectId: project.id,
        workspace: {
          type: "unmanaged",
          path: harness.repoDir,
        },
      });

      await sendTextMessage(harness.api, thread.id, {
        text: "call_tool_unresolved:message_user",
      });
      const managerMessageEvent = await waitForEventType(
        harness.api,
        thread.id,
        "system/manager/user_message",
        TURN_TIMEOUT_MS,
      );
      await waitForThreadStatus(
        harness.api,
        thread.id,
        "idle",
        TURN_TIMEOUT_MS,
      );

      const resolvedTurnId = getThreadEventScopeTurnId(
        managerMessageEvent.scope,
      );
      if (!resolvedTurnId) {
        throw new Error("Expected manager message to be turn-scoped");
      }

      const events = await getThreadEvents(harness.api, thread.id);
      const turnStartedEvent = events.find(
        (event) =>
          event.type === "turn/started" &&
          getThreadEventScopeTurnId(event.scope) === resolvedTurnId,
      );
      if (!turnStartedEvent) {
        throw new Error(
          `Expected turn/started for resolved turn ${resolvedTurnId}`,
        );
      }

      expect(turnStartedEvent.seq).toBeLessThan(managerMessageEvent.seq);
      expect(managerMessageEvent.data).toMatchObject({
        text: "Fake provider message",
        toolCallId: "call-1",
      });
    }));
});
