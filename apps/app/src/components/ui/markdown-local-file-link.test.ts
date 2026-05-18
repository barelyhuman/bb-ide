import { describe, expect, it } from "vitest";
import {
  buildLocalFileAnchorHref,
  parseLocalFileHref,
} from "./markdown-local-file-link.js";

describe("parseLocalFileHref", () => {
  it("parses absolute local paths and file URLs with optional line numbers", () => {
    expect(parseLocalFileHref("/workspace/src/app.ts")).toEqual({
      path: "/workspace/src/app.ts",
      lineNumber: null,
    });
    expect(parseLocalFileHref("/workspace/src/app.ts:12")).toEqual({
      path: "/workspace/src/app.ts",
      lineNumber: 12,
    });
    expect(parseLocalFileHref("/workspace/src/app.ts#L12")).toEqual({
      path: "/workspace/src/app.ts",
      lineNumber: 12,
    });
    expect(
      parseLocalFileHref("file:///workspace/src/file-url.ts#L4"),
    ).toEqual({
      path: "/workspace/src/file-url.ts",
      lineNumber: 4,
    });
    expect(parseLocalFileHref("/work%20space/app.ts:3")).toEqual({
      path: "/work space/app.ts",
      lineNumber: 3,
    });
  });

  it("rejects hrefs that are not unambiguous absolute local files", () => {
    expect(parseLocalFileHref("apps/app/src/main.tsx")).toBeNull();
    expect(parseLocalFileHref("README.md")).toBeNull();
    expect(parseLocalFileHref("https://example.test")).toBeNull();
    expect(parseLocalFileHref("file:///workspace/app.ts?foo=1")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts#section")).toBeNull();
    expect(parseLocalFileHref("//workspace/app.ts")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts:0")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts#L0")).toBeNull();
  });
});

describe("buildLocalFileAnchorHref", () => {
  it("rewrites absolute file-like paths while leaving non-file hrefs alone", () => {
    expect(
      buildLocalFileAnchorHref(
        { path: "apps/app/main.tsx", lineNumber: 4 },
        "apps/app/main.tsx:4",
      ),
    ).toBe("apps/app/main.tsx:4");
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/somedir", lineNumber: null },
        "/workspace/somedir",
      ),
    ).toBe("/workspace/somedir");
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/src/app.ts", lineNumber: 12 },
        "/workspace/src/app.ts:12",
      ),
    ).toBe("file:///workspace/src/app.ts#L12");
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/README.md", lineNumber: null },
        "/workspace/README.md",
      ),
    ).toBe("file:///workspace/README.md");
    expect(
      buildLocalFileAnchorHref(
        { path: "/work space/app.ts", lineNumber: 3 },
        "/work space/app.ts:3",
      ),
    ).toBe("file:///work%20space/app.ts#L3");
  });
});
