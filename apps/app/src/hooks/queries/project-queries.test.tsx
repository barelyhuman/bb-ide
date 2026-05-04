// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useProjectPromptHistory } from "./project-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    listProjectPromptHistory: vi.fn(),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useProjectPromptHistory", () => {
  it("fetches prompt history for a project", async () => {
    vi.mocked(api.listProjectPromptHistory).mockResolvedValue([
      {
        id: "event:1",
        createdAt: 1,
        input: [{ type: "text", text: "Start a debugging thread" }],
      },
    ]);

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useProjectPromptHistory("proj_1"), {
      wrapper,
    });

    await waitFor(() => {
      expect(result.current.data?.[0]?.id).toBe("event:1");
    });

    expect(api.listProjectPromptHistory).toHaveBeenCalledWith(
      "proj_1",
      expect.anything(),
    );
  });

  it("stays disabled without a project id", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useProjectPromptHistory(undefined), {
      wrapper,
    });

    expect(result.current.fetchStatus).toBe("idle");
    expect(api.listProjectPromptHistory).not.toHaveBeenCalled();
  });
});
