// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as api from "@/lib/api";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { useHost } from "./system-queries";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getHost: vi.fn(),
  };
});

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Sandbox Host",
    status: "connected",
    type: "ephemeral",
    updatedAt: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useHost", () => {
  it("fetches a single host by id", async () => {
    vi.mocked(api.getHost).mockResolvedValue(makeHost());

    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useHost("host-1"), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.id).toBe("host-1");
    });

    expect(api.getHost).toHaveBeenCalledWith("host-1");
  });

  it("stays disabled without a host id", () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useHost(undefined), { wrapper });

    expect(result.current.fetchStatus).toBe("idle");
    expect(api.getHost).not.toHaveBeenCalled();
  });
});
