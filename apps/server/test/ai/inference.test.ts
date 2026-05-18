import { Type } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import {
  InferenceTimeoutError,
  inferenceComplete,
} from "../../src/services/ai/inference.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import { seedHostSession } from "../helpers/seed.js";
import { createTestAppHarness } from "../helpers/test-app.js";

const titleSchema = Type.Object({
  title: Type.String(),
});

describe("inferenceComplete", () => {
  it("surfaces missing host for codex inference", async () => {
    const harness = await createTestAppHarness({
      inferenceModel: "codex/gpt-5.4-mini",
    });
    try {
      await expect(
        inferenceComplete(harness.deps, {
          prompt: "Generate a title",
          schema: titleSchema,
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject({
        body: {
          code: "host_disconnected",
        },
        status: 502,
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("routes codex inference through the host daemon and validates structured output", async () => {
    const harness = await createTestAppHarness({
      inferenceModel: "codex/gpt-5.4-mini",
    });
    try {
      const { host } = seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      expect(queued.row.hostId).toBe(host.id);
      expect(queued.command).toMatchObject({
        type: "codex.inference.complete",
        model: "gpt-5.4-mini",
        prompt: "Generate a title",
        timeoutMs: 5000,
      });

      await reportQueuedCommandSuccess(harness, queued, {
        model: "gpt-5.4-mini",
        value: { title: "Generated title" },
      });

      await expect(completion).resolves.toEqual({
        title: "Generated title",
      });
    } finally {
      await harness.cleanup();
    }
  });

  it("converts codex daemon timeouts into inference timeouts", async () => {
    const harness = await createTestAppHarness({
      inferenceModel: "codex/gpt-5.4-mini",
    });
    try {
      seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      await reportQueuedCommandError(harness, queued, {
        errorCode: "codex_request_timeout",
        errorMessage: "Codex request timed out after 5000ms",
      });

      await expect(completion).rejects.toBeInstanceOf(InferenceTimeoutError);
    } finally {
      await harness.cleanup();
    }
  });

  it("surfaces codex daemon auth errors", async () => {
    const harness = await createTestAppHarness({
      inferenceModel: "codex/gpt-5.4-mini",
    });
    try {
      seedHostSession(harness.deps);
      const completion = inferenceComplete(harness.deps, {
        prompt: "Generate a title",
        schema: titleSchema,
        timeoutMs: 5000,
      });

      const queued = await waitForQueuedCommand(
        harness,
        ({ command }) => command.type === "codex.inference.complete",
      );
      await reportQueuedCommandError(harness, queued, {
        errorCode: "codex_auth_missing",
        errorMessage: "Codex auth file not found",
      });

      await expect(completion).rejects.toMatchObject({
        body: {
          code: "codex_auth_missing",
        },
        status: 502,
      });
    } finally {
      await harness.cleanup();
    }
  });
});
