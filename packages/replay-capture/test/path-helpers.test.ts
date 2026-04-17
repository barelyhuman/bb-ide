import { describe, expect, it } from "vitest";
import {
  createReplayCaptureId,
  isReplayCaptureId,
  replayCaptureDir,
  replayCaptureManifestPath,
  resolveContainedReplayCapturePath,
} from "../src/index.js";

describe("replay capture path helpers", () => {
  it("creates and validates capture ids", () => {
    const captureId = createReplayCaptureId(1234, "abc123zz");

    expect(captureId).toBe("cap_ya_abc123zz");
    expect(isReplayCaptureId(captureId)).toBe(true);
    expect(isReplayCaptureId("../cap_ya_abc123zz")).toBe(false);
  });

  it("resolves capture paths under the replay root", () => {
    const dataDir = "/tmp/bb-data";
    const captureId = "cap_ya_abc123zz";

    expect(replayCaptureDir(dataDir, captureId)).toBe(
      "/tmp/bb-data/replays/cap_ya_abc123zz",
    );
    expect(replayCaptureManifestPath(dataDir, captureId)).toBe(
      "/tmp/bb-data/replays/cap_ya_abc123zz/manifest.json",
    );
  });

  it("rejects traversal capture ids and escaping segments", () => {
    expect(() => replayCaptureDir("/tmp/bb-data", "../secrets")).toThrow(
      /Invalid replay capture id/u,
    );
    expect(() =>
      resolveContainedReplayCapturePath({
        dataDir: "/tmp/bb-data",
        segments: ["..", "secrets"],
      }),
    ).toThrow(/escapes replay root/u);
  });
});
