import { afterEach, describe, expect, it } from "vitest";
import { createTestAppHarness } from "./helpers/test-app.js";
import {
  seedEnvironment,
  seedEvent,
  seedHost,
  seedProjectWithSource,
  seedThread,
} from "./helpers/seed.js";
import { getTimelineBenchmarkScenarios } from "./helpers/timeline-benchmark.js";
import { buildThreadTimeline } from "../src/services/timeline.js";

describe("buildThreadTimeline", () => {
  const scenarios = getTimelineBenchmarkScenarios();
  const harnesses: Array<Awaited<ReturnType<typeof createTestAppHarness>>> = [];

  afterEach(async () => {
    while (harnesses.length > 0) {
      const harness = harnesses.pop();
      if (!harness) {
        continue;
      }
      await harness.cleanup();
    }
  });

  for (const scenario of scenarios) {
    it(`matches the direct projection pipeline for ${scenario.id}`, () => {
      expect(scenario.buildSummary()).toEqual(scenario.buildExpectedSummary());
    });

    it(`keeps the summary payload smaller than the full grouped payload for ${scenario.id}`, () => {
      expect(scenario.summaryBytes).toBeLessThan(scenario.fullBytes);
    });
  }

  it("keeps the last non-null modelContextWindow when the newest token-usage row omits it", async () => {
    const harness = await createTestAppHarness();
    harnesses.push(harness);

    const host = seedHost(harness.deps);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const environment = seedEnvironment(harness.deps, {
      hostId: host.id,
      projectId: project.id,
    });
    const thread = seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
    });

    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "provider-thread-1",
      turnId: "turn-1",
      sequence: 1,
      type: "thread/tokenUsage/updated",
      data: {
        tokenUsage: {
          total: {
            totalTokens: 120,
            inputTokens: 80,
            cachedInputTokens: 0,
            outputTokens: 40,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 120,
            inputTokens: 80,
            cachedInputTokens: 0,
            outputTokens: 40,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: 200_000,
        },
      },
    });
    seedEvent(harness.deps, {
      threadId: thread.id,
      environmentId: environment.id,
      providerThreadId: "provider-thread-1",
      turnId: "turn-2",
      sequence: 2,
      type: "thread/tokenUsage/updated",
      data: {
        tokenUsage: {
          total: {
            totalTokens: 180,
            inputTokens: 110,
            cachedInputTokens: 0,
            outputTokens: 70,
            reasoningOutputTokens: 0,
          },
          last: {
            totalTokens: 60,
            inputTokens: 30,
            cachedInputTokens: 0,
            outputTokens: 30,
            reasoningOutputTokens: 0,
          },
          modelContextWindow: null,
        },
      },
    });

    const timeline = buildThreadTimeline(harness.db, thread, {});

    expect(timeline.contextWindowUsage).toEqual({
      totalTokens: 60,
      modelContextWindow: 200_000,
    });
  });
});
