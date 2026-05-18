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
        supportedPermissionModes: ["bypass"],
      }),
    ).toBe("bypass");
    expect(
      resolvePermissionModeSelection({
        rawPermissionMode: "readonly",
        supportedPermissionModes: [],
      }),
    ).toBe("full");
  });
});
