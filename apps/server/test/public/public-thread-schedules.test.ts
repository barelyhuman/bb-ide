import { eq } from "drizzle-orm";
import {
  createThreadSchedule,
  getThreadSchedule,
  threadSchedules,
} from "@bb/db";
import { threadScheduleSchema } from "@bb/server-contract";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import { seedThreadFixture } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("public thread schedule routes", () => {
  it("supports thread schedule CRUD", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        session: { id: "host-thread-schedule-crud" },
      });

      const invalidResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Bad schedule",
            cron: "* * * * *",
            timezone: "Mars/Olympus",
            prompt: "Should fail.",
          }),
        },
      );
      expect(invalidResponse.status).toBe(400);

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Daily summary",
            cron: "0 8 * * 1-5",
            timezone: "America/Los_Angeles",
            prompt: "Review current work and summarize useful progress.",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const created = threadScheduleSchema.parse(
        await readJson(createResponse),
      );
      expect(created).toMatchObject({
        threadId: thread.id,
        name: "Daily summary",
        enabled: true,
        kind: "cron",
      });
      expect(created.nextFireAt).toBeTypeOf("number");

      const duplicateResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Daily summary",
            cron: "0 9 * * 1-5",
            timezone: "UTC",
            prompt: "Duplicate.",
          }),
        },
      );
      expect(duplicateResponse.status).toBe(409);

      const conflictingCreateResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Afternoon summary",
            cron: "0 14 * * 1-5",
            timezone: "UTC",
            prompt: "Second schedule.",
          }),
        },
      );
      expect(conflictingCreateResponse.status).toBe(201);
      const conflictingSchedule = threadScheduleSchema.parse(
        await readJson(conflictingCreateResponse),
      );

      const duplicateRenameResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${conflictingSchedule.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Daily summary" }),
        },
      );
      expect(duplicateRenameResponse.status).toBe(409);

      const listResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
      );
      expect(listResponse.status).toBe(200);
      expect(
        threadScheduleSchema.array().parse(await readJson(listResponse)),
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: conflictingSchedule.id,
            name: "Afternoon summary",
          }),
          expect.objectContaining({
            id: created.id,
            name: "Daily summary",
          }),
        ]),
      );

      const updateResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            cron: "0 10 * * 1-5",
            timezone: "UTC",
            prompt: "Review current work at 10 UTC.",
          }),
        },
      );
      expect(updateResponse.status).toBe(200);
      const updated = threadScheduleSchema.parse(
        await readJson(updateResponse),
      );
      expect(updated).toMatchObject({
        cron: "0 10 * * 1-5",
        timezone: "UTC",
        prompt: "Review current work at 10 UTC.",
      });

      const enabledNoopResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        },
      );
      expect(enabledNoopResponse.status).toBe(200);
      expect(
        threadScheduleSchema.parse(await readJson(enabledNoopResponse))
          .updatedAt,
      ).toBe(updated.updatedAt);

      const disableResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        },
      );
      expect(disableResponse.status).toBe(200);
      const disabled = threadScheduleSchema.parse(
        await readJson(disableResponse),
      );
      expect(disabled.enabled).toBe(false);

      const disabledNoopResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: false }),
        },
      );
      expect(disabledNoopResponse.status).toBe(200);
      expect(
        threadScheduleSchema.parse(await readJson(disabledNoopResponse))
          .updatedAt,
      ).toBe(disabled.updatedAt);

      harness.db
        .update(threadSchedules)
        .set({ nextFireAt: 1, updatedAt: disabled.updatedAt })
        .where(eq(threadSchedules.id, created.id))
        .run();
      const enableResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled: true }),
        },
      );
      expect(enableResponse.status).toBe(200);
      const reenabled = threadScheduleSchema.parse(
        await readJson(enableResponse),
      );
      expect(reenabled).toMatchObject({ enabled: true });
      expect(reenabled.nextFireAt).toBeGreaterThan(Date.now());

      const deleteResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteResponse.status).toBe(200);
      expect(await readJson(deleteResponse)).toEqual({ ok: true });
    });
  });

  it("rejects unsupported route-level schedule definitions", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        session: { id: "host-thread-schedule-validation" },
      });

      const tooFrequentResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Too frequent",
            cron: "0,1 8 * * *",
            timezone: "UTC",
            prompt: "Should fail.",
          }),
        },
      );
      expect(tooFrequentResponse.status).toBe(400);

      const monthFieldResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Month field",
            cron: "0 8 * 2 *",
            timezone: "UTC",
            prompt: "Should fail.",
          }),
        },
      );
      expect(monthFieldResponse.status).toBe(400);
    });
  });

  it("supports explicit disabled create and validates patch shapes", async () => {
    await withTestHarness(async (harness) => {
      const { thread } = seedThreadFixture(harness, {
        session: { id: "host-thread-schedule-disabled-create" },
      });

      const createResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Paused schedule",
            enabled: false,
            cron: "0 8 * * *",
            timezone: "UTC",
            prompt: "Start paused.",
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const created = threadScheduleSchema.parse(
        await readJson(createResponse),
      );
      expect(created.enabled).toBe(false);

      const mixedPatchResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/${created.id}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            enabled: true,
            cron: "0 9 * * *",
          }),
        },
      );
      expect(mixedPatchResponse.status).toBe(400);

      const unknownPatchResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/schedules/tsched_missing`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "Missing schedule" }),
        },
      );
      expect(unknownPatchResponse.status).toBe(404);
    });
  });

  it("disables schedules when a thread is archived and leaves them disabled on unarchive", async () => {
    await withTestHarness(async (harness) => {
      const { project, thread } = seedThreadFixture(harness, {
        session: { id: "host-thread-schedule-archive" },
      });
      const now = Date.now();
      const schedule = createThreadSchedule(harness.db, harness.hub, {
        projectId: project.id,
        threadId: thread.id,
        name: "Archive pause",
        cron: "0 8 * * *",
        timezone: "UTC",
        prompt: "Should pause while archived.",
        enabled: true,
        nextFireAt: now + 60_000,
      });

      const archiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/archive`,
        {
          method: "POST",
        },
      );

      expect(archiveResponse.status).toBe(200);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        enabled: false,
        prompt: "Should pause while archived.",
      });

      const unarchiveResponse = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        {
          method: "POST",
        },
      );

      expect(unarchiveResponse.status).toBe(200);
      expect(getThreadSchedule(harness.db, schedule.id)).toMatchObject({
        enabled: false,
        prompt: "Should pause while archived.",
      });
    });
  });
});
