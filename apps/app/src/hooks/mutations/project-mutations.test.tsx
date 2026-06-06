// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createManagerThreadRequestSchema,
  type CreateManagerThreadRequest,
} from "@bb/server-contract";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { useHireProjectManager } from "./project-mutations";

// Hire-manager carries every execution-input field the user picked in the
// composer: model, service tier, reasoning level, the per-field source
// metadata, the chosen environment, and (optionally) a first user message.
// If any of those drop on the floor between the hook and the wire, the manager
// boots with the wrong defaults — silently. Assert against the real HTTP body
// (parsed through the canonical contract schema) so both the hook field
// projection AND the api layer's `origin: "app"` stamp are covered.
describe("useHireProjectManager", () => {
  afterEach(() => {
    cleanup();
  });

  it("posts the full manager execution payload to /api/v1/projects/:id/managers", async () => {
    const requestBodies: CreateManagerThreadRequest[] = [];
    installFetchRoutes([
      {
        method: "POST",
        pathname: "/api/v1/projects/project-1/managers",
        handler: async (request) => {
          requestBodies.push(
            createManagerThreadRequestSchema.parse(await request.json()),
          );
          return jsonResponse({
            archivedAt: null,
            automationId: null,
            createdAt: 1,
            deletedAt: null,
            environmentId: "environment-1",
            id: "thread-1",
            lastReadAt: null,
            latestAttentionAt: 1,
            parentThreadId: null,
            pinnedAt: null,
            projectId: "project-1",
            providerId: "codex",
            runtime: {
              displayStatus: "idle",
              hostReconnectGraceExpiresAt: null,
            },
            status: "idle",
            stopRequestedAt: null,
            title: "Manager",
            titleFallback: "Manager",
            type: "manager",
            updatedAt: 1,
          });
        },
      },
    ]);

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useHireProjectManager(), { wrapper });

    await act(async () => {
      await result.current.mutateAsync({
        projectId: "project-1",
        name: "Manager",
        providerId: "codex",
        model: "gpt-5.5",
        serviceTier: "fast",
        reasoningLevel: "xhigh",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          serviceTier: "explicit",
          reasoningLevel: "explicit",
        },
        environment: { type: "host", hostId: "host-1" },
        input: [{ type: "text", text: "Start here", mentions: [] }],
      });
    });

    expect(requestBodies).toEqual([
      {
        name: "Manager",
        providerId: "codex",
        model: "gpt-5.5",
        serviceTier: "fast",
        reasoningLevel: "xhigh",
        executionInputSources: {
          providerId: "explicit",
          model: "explicit",
          serviceTier: "explicit",
          reasoningLevel: "explicit",
        },
        environment: { type: "host", hostId: "host-1" },
        input: [{ type: "text", text: "Start here", mentions: [] }],
        // The api layer must stamp origin so the server attributes the create
        // to the in-app composer (vs. the CLI / automation paths).
        origin: "app",
      },
    ]);
  });
});
