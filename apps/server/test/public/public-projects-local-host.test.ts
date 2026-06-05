import { z } from "zod";
import { describe, expect, it } from "vitest";
import { readJson } from "../helpers/json.js";
import {
  seedHost,
  seedHostSession,
  seedPrimaryHost,
} from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

const projectResponseSchema = z.object({
  id: z.string(),
  sources: z.array(
    z.object({
      id: z.string(),
      path: z.string().nullable().optional(),
    }),
  ),
});

describe("public project local host routes", () => {
  it("supports local project source updates and rejects secondary host sources", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host-source-1" });
      seedPrimaryHost(harness.deps, host.id);
      const secondaryHost = seedHost(harness.deps, { id: "host-source-2" });

      const projectResponse = await harness.app.request("/api/v1/projects", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          name: "Project Sources",
          source: {
            type: "local_path",
            hostId: host.id,
            path: "/tmp/project-sources",
          },
        }),
      });
      const project = projectResponseSchema.parse(
        await readJson(projectResponse),
      );
      const defaultSourceId = project.sources[0]?.id;
      expect(defaultSourceId).toBeTruthy();

      const createSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            hostId: secondaryHost.id,
            path: "/tmp/project-sources-2",
            type: "local_path",
          }),
        },
      );
      expect(createSourceResponse.status).toBe(400);
      await expect(readJson(createSourceResponse)).resolves.toMatchObject({
        code: "unsupported_host",
      });

      const updateSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${defaultSourceId}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            type: "local_path",
            path: "/tmp/project-sources-renamed",
          }),
        },
      );
      expect(updateSourceResponse.status).toBe(200);
      await expect(readJson(updateSourceResponse)).resolves.toMatchObject({
        id: defaultSourceId,
        path: "/tmp/project-sources-renamed",
      });

      const deleteSourceResponse = await harness.app.request(
        `/api/v1/projects/${project.id}/sources/${defaultSourceId}`,
        {
          method: "DELETE",
        },
      );
      expect(deleteSourceResponse.status).toBe(409);
    });
  });
});
