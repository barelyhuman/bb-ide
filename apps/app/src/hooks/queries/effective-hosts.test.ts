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
  it("keeps raw host status before the initial server websocket connects", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "connected" }),
        serverConnectionState: "connecting",
      }).status,
    ).toBe("connected");
  });

  it("treats cached connected hosts as disconnected while reconnecting", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "connected" }),
        serverConnectionState: "reconnecting",
      }).status,
    ).toBe("disconnected");
  });

  it("preserves disconnected hosts while reconnecting", () => {
    expect(
      getEffectiveHost({
        host: makeHost({ status: "disconnected" }),
        serverConnectionState: "reconnecting",
      }).status,
    ).toBe("disconnected");
  });
});
