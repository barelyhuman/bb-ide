import { beforeEach, describe, expect, it, vi } from "vitest";
import { seedProjectWithSource, seedHostSession } from "./helpers/seed.js";
import { createTestAppHarness } from "./helpers/test-app.js";

async function readJson(response: Response): Promise<unknown> {
  return response.json();
}

describe("public automation routes", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-02T12:00:00.000Z"));
  });

  it("supports automation CRUD", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, { id: "host-automation-crud" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      const createResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            name: "Daily summary",
            trigger: {
              triggerType: "schedule",
              cron: "0 8 * * 1-5",
              timezone: "America/Los_Angeles",
            },
            action: {
              actionType: "scheduled-thread",
              threadRequest: {
                providerId: "codex",
                model: "gpt-5",
                input: [{ type: "text", text: "Summarize yesterday's work" }],
                environment: {
                  type: "host",
                  hostId: host.id,
                  workspace: { type: "managed-clone" },
                },
              },
            },
          }),
        },
      );
      expect(createResponse.status).toBe(201);
      const createdAutomation = await readJson(createResponse) as {
        id: string;
        autoArchive: boolean;
        enabled: boolean;
        nextRunAt: number | null;
        trigger: { cron: string };
      };
      expect(createdAutomation.enabled).toBe(true);
      expect(createdAutomation.autoArchive).toBe(false);
      expect(createdAutomation.trigger.cron).toBe("0 8 * * 1-5");
      expect(createdAutomation.nextRunAt).toBeTypeOf("number");

      const listResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations`,
      );
      expect(listResponse.status).toBe(200);
      await expect(readJson(listResponse)).resolves.toEqual([
        expect.objectContaining({
          id: createdAutomation.id,
          name: "Daily summary",
        }),
      ]);

      const disableResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: false,
          }),
        },
      );
      expect(disableResponse.status).toBe(200);
      await expect(readJson(disableResponse)).resolves.toMatchObject({
        id: createdAutomation.id,
        enabled: false,
        nextRunAt: null,
      });

      const enableResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            enabled: true,
            autoArchive: true,
          }),
        },
      );
      expect(enableResponse.status).toBe(200);
      await expect(readJson(enableResponse)).resolves.toMatchObject({
        id: createdAutomation.id,
        enabled: true,
        autoArchive: true,
      });

      const deleteResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/automations/${createdAutomation.id}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteResponse.status).toBe(200);
      await expect(readJson(deleteResponse)).resolves.toEqual({ ok: true });
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });

  it("rejects invalid cron expressions, invalid timezones, and sub-5-minute schedules", async () => {
    const harness = await createTestAppHarness();
    try {
      const { host } = seedHostSession(harness.deps, { id: "host-automation-validation" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });

      for (const trigger of [
        {
          triggerType: "schedule",
          cron: "not-a-cron",
          timezone: "UTC",
        },
        {
          triggerType: "schedule",
          cron: "0 8 * * 1-5",
          timezone: "Mars/Olympus",
        },
        {
          triggerType: "schedule",
          cron: "* * * * *",
          timezone: "UTC",
        },
      ] as const) {
        const response = await harness.app.request(
          `/api/v1/projects/${project.id}/automations`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
            },
            body: JSON.stringify({
              name: "Invalid schedule",
              trigger,
              action: {
                actionType: "scheduled-thread",
                threadRequest: {
                  providerId: "codex",
                  model: "gpt-5",
                  input: [{ type: "text", text: "Run invalid schedule" }],
                  environment: {
                    type: "host",
                    hostId: host.id,
                    workspace: { type: "managed-clone" },
                  },
                },
              },
            }),
          },
        );
        expect(response.status).toBe(400);
      }
    } finally {
      vi.useRealTimers();
      await harness.cleanup();
    }
  });
});
