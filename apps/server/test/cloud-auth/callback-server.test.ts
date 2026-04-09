import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { startOAuthCallbackServer } from "../../src/services/cloud-auth/callback-server.js";

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to reserve callback test port");
  }
  const { port } = address;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  return port;
}

describe("OAuth callback server", () => {
  it("accepts the matching callback and resolves the waiter", async () => {
    const port = await reservePort();
    const server = await startOAuthCallbackServer({
      errorTitle: "OAuth failed",
      expectedState: "expected-state",
      listenHost: "127.0.0.1",
      path: "/callback",
      port,
      successTitle: "OAuth completed",
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/callback?code=test-code&state=expected-state`,
      );

      expect(response.status).toBe(200);
      await expect(response.text()).resolves.toContain("OAuth completed");
      await expect(server.waitForCode()).resolves.toEqual({
        code: "test-code",
        state: "expected-state",
      });
    } finally {
      await server.close();
    }
  });

  it("escapes reflected provider errors in the callback HTML", async () => {
    const port = await reservePort();
    const server = await startOAuthCallbackServer({
      errorTitle: "OAuth failed",
      expectedState: "expected-state",
      listenHost: "127.0.0.1",
      path: "/callback",
      port,
      successTitle: "OAuth completed",
    });

    try {
      const response = await fetch(
        `http://127.0.0.1:${port}/callback?error=${encodeURIComponent("<script>alert(1)</script>")}`,
      );

      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
      expect(html).not.toContain("<script>alert(1)</script>");

      server.cancelWait();
      await expect(server.waitForCode()).resolves.toBeNull();
    } finally {
      await server.close();
    }
  });

  it("returns helpful errors for wrong paths, missing params, and state mismatches", async () => {
    const port = await reservePort();
    const server = await startOAuthCallbackServer({
      errorTitle: "OAuth failed",
      expectedState: "expected-state",
      listenHost: "127.0.0.1",
      path: "/callback",
      port,
      successTitle: "OAuth completed",
    });

    try {
      const wrongPath = await fetch(`http://127.0.0.1:${port}/wrong-path`);
      expect(wrongPath.status).toBe(404);
      await expect(wrongPath.text()).resolves.toContain("Callback not found");

      const missingParams = await fetch(`http://127.0.0.1:${port}/callback`);
      expect(missingParams.status).toBe(400);
      await expect(missingParams.text()).resolves.toContain(
        "missing the expected authorization code or state",
      );

      const mismatchedState = await fetch(
        `http://127.0.0.1:${port}/callback?code=test-code&state=wrong-state`,
      );
      expect(mismatchedState.status).toBe(400);
      await expect(mismatchedState.text()).resolves.toContain(
        "does not match the active connection attempt",
      );

      server.cancelWait();
      await expect(server.waitForCode()).resolves.toBeNull();
    } finally {
      await server.close();
    }
  });
});
