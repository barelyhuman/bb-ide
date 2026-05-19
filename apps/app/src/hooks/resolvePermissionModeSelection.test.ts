import { describe, expect, it } from "vitest";
import { resolvePermissionModeSelection } from "./useThreadCreationOptions";

describe("resolvePermissionModeSelection", () => {
  it("chooses the raw permission mode when supported and otherwise falls back predictably", () => {
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "readonly",
        supportedPermissionModes: ["full", "readonly"],
      }),
    ).toBe("readonly");
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "readonly",
        supportedPermissionModes: ["full"],
      }),
    ).toBe("full");
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "readonly",
        supportedPermissionModes: ["workspace-write"],
      }),
    ).toBe("workspace-write");
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "readonly",
        supportedPermissionModes: [],
      }),
    ).toBe("full");
  });
});
