import { describe, expect, it, vi } from "vitest";

const statusGet = vi.fn();

vi.mock("@bb/host-daemon-contract", () => ({
  createHostDaemonLocalClient: () => ({
    status: { $get: statusGet },
  }),
}));

const { fetchHostId } = await import("./api-host-daemon");

describe("fetchHostId", () => {
  it("returns hostId when daemon is connected", async () => {
    statusGet.mockResolvedValue({
      ok: true,
      json: async () => ({ hostId: "host_1", connected: true, serverUrl: "http://localhost:3334" }),
    });

    expect(await fetchHostId(3002)).toBe("host_1");
  });

  it("returns null when daemon is not connected to the server", async () => {
    statusGet.mockResolvedValue({
      ok: true,
      json: async () => ({ hostId: "host_1", connected: false, serverUrl: "http://localhost:3334" }),
    });

    expect(await fetchHostId(3002)).toBeNull();
  });

  it("returns null when daemon is unreachable", async () => {
    statusGet.mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await fetchHostId(3002)).toBeNull();
  });

  it("returns null when status response is not ok", async () => {
    statusGet.mockResolvedValue({ ok: false });

    expect(await fetchHostId(3002)).toBeNull();
  });
});
