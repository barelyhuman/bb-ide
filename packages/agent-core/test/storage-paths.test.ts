import { afterEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import {
  expandHomeDirectory,
  resolveBeanbagPath,
  resolveBeanbagRoot,
} from "../src/storage-paths.js";

const originalHome = process.env.HOME;
const originalBeanbagRoot = process.env.BEANBAG_ROOT;

afterEach(() => {
  process.env.HOME = originalHome;
  process.env.BEANBAG_ROOT = originalBeanbagRoot;
});

describe("storage paths", () => {
  it("defaults to ~/.beanbag when BEANBAG_ROOT is unset", () => {
    process.env.HOME = "/Users/tester";
    delete process.env.BEANBAG_ROOT;

    expect(resolveBeanbagRoot(process.env)).toBe("/Users/tester/.beanbag");
    expect(resolveBeanbagPath(process.env, "logs", "daemon.log")).toBe(
      "/Users/tester/.beanbag/logs/daemon.log",
    );
  });

  it("uses an explicit BEANBAG_ROOT when configured", () => {
    process.env.BEANBAG_ROOT = "/tmp/beanbag-root";

    expect(resolveBeanbagRoot(process.env)).toBe("/tmp/beanbag-root");
    expect(resolveBeanbagPath(process.env, "environment-agents")).toBe(
      "/tmp/beanbag-root/environment-agents",
    );
  });

  it("expands home-relative BEANBAG_ROOT values", () => {
    process.env.HOME = "/Users/tester";
    process.env.BEANBAG_ROOT = "~/sandbox/beanbag";

    expect(expandHomeDirectory(process.env.BEANBAG_ROOT)).toBe(
      "/Users/tester/sandbox/beanbag",
    );
    expect(resolveBeanbagRoot(process.env)).toBe(
      resolve("/Users/tester/sandbox/beanbag"),
    );
  });
});
