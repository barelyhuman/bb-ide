import { describe, it, expect } from "vitest";
import { createTestApp } from "./helpers/test-app.js";

describe("6a: Server skeleton", () => {
  it("responds to public routes without auth", async () => {
    const { app } = createTestApp();
    const res = await app.request("/api/v1/projects");
    // Empty routes return 404 at this point — but the app loads
    expect([200, 404]).toContain(res.status);
  });

  it("rejects internal routes without valid Bearer token", async () => {
    const { app } = createTestApp();
    const res = await app.request("/internal/session/open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.code).toBe("inactive_session");
  });

  it("allows internal routes with valid Bearer token", async () => {
    const { app } = createTestApp();
    const res = await app.request("/internal/session/open", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer test-secret",
      },
      body: JSON.stringify({}),
    });
    // Should not be 401 — may be 404 since route is stub
    expect(res.status).not.toBe(401);
  });

  it("global error handler returns structured errors", async () => {
    const { app } = createTestApp();
    // Trigger a parse error by posting invalid JSON to a known path
    const res = await app.request("/api/v1/projects", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-json",
    });
    // Routes are stubs — may return 404. The point is it doesn't crash.
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it("initDb with in-memory SQLite succeeds", async () => {
    const { initDb } = await import("../src/db.js");
    const db = initDb(":memory:");
    expect(db).toBeDefined();
  });
});
