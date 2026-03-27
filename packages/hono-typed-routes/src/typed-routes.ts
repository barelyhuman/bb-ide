/**
 * Contract-enforced route registration for Hono.
 *
 * Hono's built-in `.get()` / `.post()` methods infer the schema from the
 * handler (bottom-up). They never constrain the handler against a pre-declared
 * schema. These helpers close that gap: given a schema type like
 * `PublicApiSchema`, they extract the expected `Input` and `Output` for each
 * route and enforce both at compile time.
 *
 * **Output**: the handler's `c.json()` argument must match the contract's
 * declared Output type.
 *
 * **Input**: if the contract declares `{ json: T }`, the registration call
 * requires a `ZodType<T>` schema. The wrapper validates the request body
 * automatically and passes the parsed value to the handler — the handler
 * never touches raw input.
 *
 * @example
 * ```ts
 * const { get, post } = typedRoutes<PublicApiSchema>(app);
 *
 * // GET — no body, output is type-checked:
 * get("/system/config", (c) => c.json({ hostDaemonPort: 1234 }));
 *
 * // POST — schema required, body pre-validated, output type-checked:
 * post("/projects", createProjectRequestSchema, async (c, body) => {
 *   const project = createProject(deps.db, body);
 *   return c.json(project, 201);
 * });
 * ```
 */
import type { Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError, type ZodType } from "zod";
import type { Endpoint } from "./endpoint.js";

// ---------------------------------------------------------------------------
// Type-level extraction
// ---------------------------------------------------------------------------

type EndpointInput<E> = E extends Endpoint<infer I, any, any, any> ? I : never;

/** Extract `T` from `{ json: T }` in the Endpoint's Input, or `never`. */
type JsonBody<I> = I extends { json: infer J } ? J : never;

// ---------------------------------------------------------------------------
// Constrained context & handler types
// ---------------------------------------------------------------------------

type HandlerReturn = Response | Promise<Response>;

/**
 * Build the valid argument tuples for `json()` from an Endpoint (or union).
 *
 * Each union member produces its own `[data, status]` or `[data]` tuple.
 * The result is a union of tuples, so `c.json(A, 200)` and `c.json(B, 409)`
 * are both legal but `c.json(A, 409)` is not — TypeScript checks the tuple
 * as a whole, preserving the output↔status pairing.
 */
type TypedJsonArgs<E> = E extends Endpoint<any, infer O, infer S extends ContentfulStatusCode, any>
  ? 200 extends S
    ? [data: O] | [data: O, status: S]
    : [data: O, status: S]
  : never;

/**
 * A Context with a constrained `json()` method.
 *
 * For union endpoints, `json()` accepts a union of argument tuples —
 * one per Endpoint member — so the output↔status pairing is preserved.
 */
type TypedContext<E, Path extends string> =
  Omit<Context<{}, Path>, "json"> & {
    json: (...args: TypedJsonArgs<E>) => Response;
  };

/** Handler that receives context only (no request body). */
type NoBodyHandler<E, Path extends string> = (
  c: TypedContext<E, Path>,
) => HandlerReturn;

/** Handler that receives context + pre-validated body. */
type WithBodyHandler<E, Body, Path extends string> = (
  c: TypedContext<E, Path>,
  body: Body,
) => HandlerReturn;

// ---------------------------------------------------------------------------
// Registration overloads
// ---------------------------------------------------------------------------

type MethodKey = "$get" | "$post" | "$patch" | "$delete" | "$put";
type HttpMethod = "get" | "post" | "patch" | "delete" | "put";

/**
 * Typed route registration.
 *
 * - If the endpoint declares `{ json: T }` input → requires `(path, schema, handler)`
 * - Otherwise → requires `(path, handler)`
 */
type TypedRegister<Schema, MKey extends MethodKey> = <
  Path extends string & keyof Schema,
  E extends MKey extends keyof Schema[Path] ? Schema[Path][MKey] : never,
  Body extends JsonBody<EndpointInput<E>>,
>(
  ...args: [Body] extends [never]
    ? [path: Path, handler: NoBodyHandler<E, Path>]
    : [path: Path, schema: ZodType<Body>, handler: WithBodyHandler<E, Body, Path>]
) => void;

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

interface TypedRoutesOptions {
  /** Factory for validation errors. Receives the Zod issue message. */
  onValidationError?: (message: string) => Error;
}

export function typedRoutes<Schema>(
  app: Hono<any, any, any>,
  options?: TypedRoutesOptions,
) {
  const makeError = options?.onValidationError ?? ((msg: string) => new Error(msg));

  function register(
    method: HttpMethod,
    path: string,
    schemaOrHandler: ZodType | Function,
    maybeHandler?: Function,
  ): void {
    if (typeof schemaOrHandler === "function") {
      // No body — just (path, handler)
      (app as any)[method](path, schemaOrHandler);
    } else {
      // With body — (path, schema, handler)
      const schema = schemaOrHandler;
      const handler = maybeHandler!;
      (app as any)[method](path, async (c: Context) => {
        let payload: unknown;
        try {
          payload = await c.req.json();
        } catch {
          throw makeError("Invalid JSON request body");
        }
        let parsed: unknown;
        try {
          parsed = schema.parse(payload);
        } catch (error) {
          if (error instanceof ZodError) {
            throw makeError(error.issues[0]?.message ?? "Invalid request");
          }
          throw error;
        }
        return handler(c, parsed);
      });
    }
  }

  return {
    get: ((...args: [string, ...any[]]) => register("get", args[0], args[1], args[2])) as TypedRegister<Schema, "$get">,
    post: ((...args: [string, ...any[]]) => register("post", args[0], args[1], args[2])) as TypedRegister<Schema, "$post">,
    patch: ((...args: [string, ...any[]]) => register("patch", args[0], args[1], args[2])) as TypedRegister<Schema, "$patch">,
    del: ((...args: [string, ...any[]]) => register("delete", args[0], args[1], args[2])) as TypedRegister<Schema, "$delete">,
    put: ((...args: [string, ...any[]]) => register("put", args[0], args[1], args[2])) as TypedRegister<Schema, "$put">,
  };
}
