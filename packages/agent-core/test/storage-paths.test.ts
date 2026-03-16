import { afterEach, describe, expect, it, vi } from "vitest";
import { resolve } from "node:path";
import {
  __testOnly__resetDeprecationWarning,
  expandHomeDirectory,
  resolveBeanbagPath,
  resolveBeanbagRoot,
} from "../src/storage-paths.js";

const originalHome = process.env.HOME;
const originalBbRoot = process.env.BB_ROOT;
const originalBeanbagRoot = process.env.BEANBAG_ROOT;

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.BB_ROOT = originalBbRoot;
  process.env.BEANBAG_ROOT = originalBeanbagRoot;
  __testOnly__resetDeprecationWarning();
});

describe("storage paths", () => {
  it("defaults to ~/.beanbag when BB_ROOT is unset", () => {
    process.env.HOME = "/Users/tester";
    delete process.env.BB_ROOT;
    delete process.env.BEANBAG_ROOT;

    expect(resolveBeanbagRoot(process.env)).toBe("/Users/tester/.beanbag");
    expect(resolveBeanbagPath(process.env, "logs", "daemon.log")).toBe(
      "/Users/tester/.beanbag/logs/daemon.log",
    );
  });

  it("uses an explicit BB_ROOT when configured", () => {
    process.env.BB_ROOT = "/tmp/beanbag-root";
    delete process.env.BEANBAG_ROOT;

    expect(resolveBeanbagRoot(process.env)).toBe("/tmp/beanbag-root");
    expect(resolveBeanbagPath(process.env, "environment-agents")).toBe(
      "/tmp/beanbag-root/environment-agents",
    );
  });

  it("expands home-relative BB_ROOT values", () => {
    process.env.HOME = "/Users/tester";
    process.env.BB_ROOT = "~/sandbox/beanbag";
    delete process.env.BEANBAG_ROOT;

    expect(expandHomeDirectory(process.env.BB_ROOT)).toBe(
      "/Users/tester/sandbox/beanbag",
    );
    expect(resolveBeanbagRoot(process.env)).toBe(
      resolve("/Users/tester/sandbox/beanbag"),
    );
  });

  it("falls back to BEANBAG_ROOT with a deprecation warning", () => {
    delete process.env.BB_ROOT;
    process.env.BEANBAG_ROOT = "/tmp/legacy-root";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(resolveBeanbagRoot(process.env)).toBe("/tmp/legacy-root");
    expect(stderrSpy).toHaveBeenCalledWith(
      "Warning: BEANBAG_ROOT is deprecated, use BB_ROOT\n",
    );

    // Second call should not warn again.
    stderrSpy.mockClear();
    resolveBeanbagRoot(process.env);
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it("prefers BB_ROOT over BEANBAG_ROOT when both are set", () => {
    process.env.BB_ROOT = "/tmp/new-root";
    process.env.BEANBAG_ROOT = "/tmp/legacy-root";
    const stderrSpy = vi.spyOn(process.stderr, "write").mockReturnValue(true);

    expect(resolveBeanbagRoot(process.env)).toBe("/tmp/new-root");
    expect(stderrSpy).not.toHaveBeenCalled();
  });
});
