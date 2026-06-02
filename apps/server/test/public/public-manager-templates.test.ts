import { describe, expect, it } from "vitest";
import { registerHostRpcResponder } from "../helpers/host-rpc.js";
import { readJson } from "../helpers/json.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

describe("GET /api/v1/manager-templates", () => {
  it("returns the default-only template list and active pointer", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-templates-default",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: (request) => {
          expect(request.command).toEqual({
            type: "host.list_manager_templates",
          });
          return {
            ok: true,
            result: {
              templates: [{ name: "default" }],
              activeName: "default",
            },
          };
        },
      });

      const response = await harness.app.request("/api/v1/manager-templates");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        templates: [{ name: "default", isActive: true }],
        activeName: "default",
      });
    });
  });

  it("marks the active template when multiple templates exist", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-templates-multi",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: true,
          result: {
            templates: [{ name: "default" }, { name: "sawyer-next" }],
            activeName: "sawyer-next",
          },
        }),
      });

      const response = await harness.app.request("/api/v1/manager-templates");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        templates: [
          { name: "default", isActive: false },
          { name: "sawyer-next", isActive: true },
        ],
        activeName: "sawyer-next",
      });
    });
  });

  it("returns activeName even when active points at a missing template", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-templates-orphan-active",
      });
      // Daemon resolves active from the on-disk file even when no matching
      // template directory exists. Falling back to "default" happens on the
      // daemon, so this case never reaches the server. The server should
      // forward whatever the daemon reports.
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: true,
          result: {
            templates: [{ name: "default" }],
            activeName: "default",
          },
        }),
      });

      const response = await harness.app.request("/api/v1/manager-templates");
      expect(response.status).toBe(200);
      await expect(readJson(response)).resolves.toEqual({
        templates: [{ name: "default", isActive: true }],
        activeName: "default",
      });
    });
  });

  it("surfaces daemon errors", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-templates-error",
      });
      registerHostRpcResponder(harness, {
        hostId: host.id,
        sessionId: session.id,
        handle: () => ({
          ok: false,
          errorCode: "permission_denied",
          errorMessage: "cannot read manager-templates",
        }),
      });

      const response = await harness.app.request("/api/v1/manager-templates");
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
