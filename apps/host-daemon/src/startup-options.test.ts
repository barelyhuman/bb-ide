import { describe, expect, it } from "vitest";
import { resolveHostDaemonEntrypointOptionsFromEnv } from "./startup-options.js";

describe("host daemon entrypoint options", () => {
  it("maps explicit startup env to typed options", () => {
    expect(
      resolveHostDaemonEntrypointOptionsFromEnv({
        env: {
          BB_BRIDGE_DIR: " /tmp/bridges ",
          BB_HOST_TYPE: "ephemeral",
        },
      }),
    ).toEqual({
      bridgeBundleDir: "/tmp/bridges",
      hostType: "ephemeral",
    });
  });

  it("drops empty startup env values", () => {
    expect(
      resolveHostDaemonEntrypointOptionsFromEnv({
        env: {
          BB_BRIDGE_DIR: "   ",
          BB_HOST_TYPE: "",
        },
      }),
    ).toEqual({
      bridgeBundleDir: undefined,
      hostType: undefined,
    });
  });

  it("rejects unknown host types", () => {
    expect(() =>
      resolveHostDaemonEntrypointOptionsFromEnv({
        env: {
          BB_HOST_TYPE: "sandbox",
        },
      }),
    ).toThrow('Invalid BB_HOST_TYPE "sandbox"');
  });
});
