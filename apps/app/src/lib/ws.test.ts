import { describe, expect, it } from "vitest";
import { parseSubKey } from "./ws";

describe("parseSubKey", () => {
  it("parses entity-only subscription keys", () => {
    expect(parseSubKey("thread")).toEqual({ entity: "thread" });
    expect(parseSubKey("system")).toEqual({ entity: "system" });
  });

  it("parses entity + id subscription keys", () => {
    expect(parseSubKey("thread:t-1")).toEqual({ entity: "thread", id: "t-1" });
  });

  it("parses all entity types", () => {
    expect(parseSubKey("project:p-1")).toEqual({
      entity: "project",
      id: "p-1",
    });
    expect(parseSubKey("environment:e-1")).toEqual({
      entity: "environment",
      id: "e-1",
    });
  });

  it("rejects unknown entities", () => {
    expect(parseSubKey("unknown")).toBeNull();
    expect(parseSubKey("bogus:id-1")).toBeNull();
  });
});
