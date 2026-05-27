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
    expect(parseLocalFileHref("/workspace/src/app.ts:12:34")).toEqual({
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
    expect(parseLocalFileHref("file://host/workspace/app.ts")).toBeNull();
    expect(parseLocalFileHref("//workspace/app.ts")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts:0")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts#L0")).toBeNull();
    expect(parseLocalFileHref("/work%00space/file.ts")).toBeNull();
    expect(parseLocalFileHref("/workspace/no-extension")).toBeNull();
  });

  it("parses local file links with non-line fragments as the file path", () => {
    expect(parseLocalFileHref("/workspace/app.ts#section")).toEqual({
      path: "/workspace/app.ts",
      lineNumber: null,
    });
    expect(parseLocalFileHref("/workspace/with#hash/app.ts:12")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts#bad/fragment")).toBeNull();
    expect(parseLocalFileHref("/workspace/app.ts#one#two")).toBeNull();
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
        { path: "/workspace/README.md", lineNumber: null },
        "/workspace/README.md#intro",
      ),
    ).toBe("file:///workspace/README.md#intro");
    expect(
      buildLocalFileAnchorHref(
        { path: "/work space/app.ts", lineNumber: 3 },
        "/work space/app.ts:3",
      ),
    ).toBe("file:///work%20space/app.ts#L3");
  });

  it("rewrites parsed extensionless file URLs consistently with click handling", () => {
    expect(
      buildLocalFileAnchorHref(
        { path: "/workspace/no-extension", lineNumber: null },
        "file:///workspace/no-extension",
      ),
    ).toBe("file:///workspace/no-extension");
  });
});
