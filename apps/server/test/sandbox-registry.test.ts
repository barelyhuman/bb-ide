import type { SandboxHost } from "@bb/sandbox-host";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSandboxHostRegistry,
  SANDBOX_HOST_REGISTRY_ENTRY_TTL_MS,
  SANDBOX_HOST_REGISTRY_MAX_ENTRIES,
} from "../src/services/sandbox-registry.js";

function createMockSandboxHost(hostId: string): SandboxHost {
  return {
    destroy: vi.fn().mockResolvedValue(undefined),
    extendTimeout: vi.fn().mockResolvedValue(undefined),
    externalId: `sandbox-${hostId}`,
    hostId,
    resume: vi.fn().mockResolvedValue(undefined),
    suspend: vi.fn().mockResolvedValue(undefined),
  };
}

describe("sandbox host registry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("evicts stale hosts after the cache TTL elapses", () => {
    vi.useFakeTimers();
    const registry = createSandboxHostRegistry();
    const host = createMockSandboxHost("host-stale");

    registry.set(host.hostId, host);
    vi.advanceTimersByTime(SANDBOX_HOST_REGISTRY_ENTRY_TTL_MS + 1);

    expect(registry.get(host.hostId)).toBeUndefined();
  });

  it("evicts the oldest cached hosts once the registry reaches capacity", () => {
    vi.useFakeTimers();
    const registry = createSandboxHostRegistry();

    for (let index = 0; index <= SANDBOX_HOST_REGISTRY_MAX_ENTRIES; index += 1) {
      registry.set(`host-${index}`, createMockSandboxHost(`host-${index}`));
      vi.advanceTimersByTime(1);
    }

    expect(registry.get("host-0")).toBeUndefined();
    expect(registry.get(`host-${SANDBOX_HOST_REGISTRY_MAX_ENTRIES}`)).toMatchObject({
      hostId: `host-${SANDBOX_HOST_REGISTRY_MAX_ENTRIES}`,
    });
  });
});
