import type { Host } from "@bb/domain";
import { describe, expect, it } from "vitest";
import { getEffectiveHost } from "./effective-hosts";

function makeHost(overrides: Partial<Host> = {}): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Host",
    status: "connected",
    type: "persistent",
    updatedAt: 1,
    ...overrides,
  };
}

describe("getEffectiveHost", () => {
  it("uses raw host status before the first connection and marks connected hosts disconnected while reconnecting", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "connected" }),
        serverConnectionState: "connecting",
      }).status,
    ).toBe("connected");
    expect(
      getEffectiveHost({
        host: makeHost({ status: "connected" }),
        serverConnectionState: "reconnecting",
      }).status,
    ).toBe("disconnected");
  });
});
