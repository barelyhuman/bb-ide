// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { resolveHostFilePreviewLinkRootPath } from "./ThreadDetailView";

describe("resolveHostFilePreviewLinkRootPath", () => {
  it("uses workspace or thread storage roots for host-file previews inside trusted roots", () => {
    expect(
      resolveHostFilePreviewLinkRootPath({
        baseDir: "/workspace/docs",
        threadStorageRootPath: "/storage/thr_1",
        workspaceRootPath: "/workspace",
      }),
    ).toBe("/workspace");
    expect(
      resolveHostFilePreviewLinkRootPath({
        baseDir: "/storage/thr_1/reports",
        threadStorageRootPath: "/storage/thr_1",
        workspaceRootPath: "/workspace",
      }),
    ).toBe("/storage/thr_1");
  });

  it("does not invent a host dirname root for previews outside trusted roots", () => {
    expect(
      resolveHostFilePreviewLinkRootPath({
        baseDir: "/etc",
        threadStorageRootPath: "/storage/thr_1",
        workspaceRootPath: "/workspace",
      }),
    ).toBeNull();
    expect(
      resolveHostFilePreviewLinkRootPath({
        baseDir: undefined,
        threadStorageRootPath: "/storage/thr_1",
        workspaceRootPath: "/workspace",
      }),
    ).toBeNull();
  });
});
