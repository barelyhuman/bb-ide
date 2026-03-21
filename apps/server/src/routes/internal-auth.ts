import type { MiddlewareHandler } from "hono";

export function bearerAuth(expectedToken: string): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header) {
      return c.json({ code: "unauthorized", message: "Missing authorization header" }, 401);
    }
    const [scheme, token] = header.split(" ", 2);
    if (scheme?.toLowerCase() !== "bearer" || token !== expectedToken) {
      return c.json({ code: "unauthorized", message: "Invalid bearer token" }, 401);
    }
    await next();
  };
}
