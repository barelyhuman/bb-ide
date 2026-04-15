// Real provider end-to-end coverage
import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  getEnvironment,
  getEnvironmentBranches,
  getEnvironmentDiff,
  getEnvironmentStatus,
  getThread,
  getThreadEvents,
  getThreadOutput,
  getThreadTimeline,
  sendTextMessage,
  stopThread,
} from "../helpers/api.js";
import { waitForThreadStatus } from "../helpers/assertions.js";
import {
  createProjectFixture,
  createReadyHostThread,
} from "../helpers/fixtures.js";
import { createIntegrationHarness } from "../helpers/harness.js";
import {
  assertProviderPrerequisites,
  countTurnEvents,
  createRealThread,
  expectNonEmptyOutput,
  getExecutionOptions,
  hasAssistantTimelineMessage,
  pathExists,
  REAL_PROVIDER_IDS,
  sendAndWaitForIdle,
  sendLongRunningTurnAndWaitStarted,
  STOP_TIMEOUT_MS,
  TEST_TIMEOUT_MS,
  TURN_TIMEOUT_MS,
  waitForUserMessageAckTextAfter,
} from "./provider-smoke-harness.js";

describe("real provider end-to-end integration", () => {
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

    it.concurrent(
      `${providerId} can interact with a managed workspace`,
      async () => {
        const { harness, environment, thread } = await createRealThread({
          providerId,
          workspace: {
            type: "managed-worktree",
          },
        });

        try {
          const initialStatus = await getEnvironmentStatus(
            harness.api,
            environment.id,
          );
          const branches = await getEnvironmentBranches(
            harness.api,
            environment.id,
          );
          expect(initialStatus.workspace?.branch.currentBranch).toBeTruthy();
          expect(branches.length).toBeGreaterThan(0);

          await sendTextMessage(harness.api, thread.id, {
            text:
              "Create a file named hello.txt in the workspace with the content hello world if tool use is available. Then briefly summarize what you did.",
            execution: getExecutionOptions(providerId),
          });
          await waitForThreadStatus(
            harness.api,
            thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          );

          const refreshedEnvironment = await getEnvironment(
            harness.api,
            environment.id,
          );
          const refreshedStatus = await getEnvironmentStatus(
            harness.api,
            environment.id,
          );
          const diff = await getEnvironmentDiff(harness.api, environment.id);
          expect(refreshedStatus.workspace?.branch.currentBranch).toBeTruthy();
          expectNonEmptyOutput(
            await getThreadOutput(harness.api, thread.id),
            `${providerId} workspace output`,
          );
          expect(typeof diff.diff).toBe("string");

          if (refreshedEnvironment.path) {
            const helloPath = path.join(refreshedEnvironment.path, "hello.txt");
            if (await pathExists(helloPath)) {
              const helloContents = await fs.readFile(helloPath, "utf8");
              expect(helloContents.trim()).toBe("hello world");
            }
          }
        } finally {
          await harness.cleanup();
        }
      },
      TEST_TIMEOUT_MS,
    );
  }

  it.concurrent(
    "runs codex and claude-code concurrently in separate environments",
    async () => {
      await assertProviderPrerequisites("codex");
      await assertProviderPrerequisites("claude-code");

      const harness = await createIntegrationHarness({ adapterFactory: undefined });

      try {
        const project = await createProjectFixture(harness, {
          name: "Real Concurrent Providers",
        });
        const codexThread = await createReadyHostThread(harness, {
          execution: getExecutionOptions("codex"),
          projectId: project.id,
          providerId: "codex",
          timeoutMs: TURN_TIMEOUT_MS,
          workspace: { type: "managed-worktree" },
        });
        const claudeThread = await createReadyHostThread(harness, {
          execution: getExecutionOptions("claude-code"),
          projectId: project.id,
          providerId: "claude-code",
          timeoutMs: TURN_TIMEOUT_MS,
          workspace: { type: "managed-worktree" },
        });

        await Promise.all([
          sendTextMessage(harness.api, codexThread.thread.id, {
            execution: getExecutionOptions("codex"),
            text: "Reply with a short hello from Codex.",
          }),
          sendTextMessage(harness.api, claudeThread.thread.id, {
            execution: getExecutionOptions("claude-code"),
            text: "Reply with a short hello from Claude.",
          }),
        ]);

        await Promise.all([
          waitForThreadStatus(
            harness.api,
            codexThread.thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          ),
          waitForThreadStatus(
            harness.api,
            claudeThread.thread.id,
            "idle",
            TURN_TIMEOUT_MS,
          ),
        ]);

        expectNonEmptyOutput(
          await getThreadOutput(harness.api, codexThread.thread.id),
          "codex concurrent output",
        );
        expectNonEmptyOutput(
          await getThreadOutput(harness.api, claudeThread.thread.id),
          "claude concurrent output",
        );
        expect(
          (await getThreadEvents(harness.api, codexThread.thread.id)).every(
            (event) => event.threadId === codexThread.thread.id,
          ),
        ).toBe(true);
        expect(
          (await getThreadEvents(harness.api, claudeThread.thread.id)).every(
            (event) => event.threadId === claudeThread.thread.id,
          ),
        ).toBe(true);
      } finally {
        await harness.cleanup();
      }
    },
    TEST_TIMEOUT_MS,
  );

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
