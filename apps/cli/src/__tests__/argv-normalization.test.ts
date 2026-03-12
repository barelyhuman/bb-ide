import { describe, expect, it } from "vitest";
import { normalizeCliArgv } from "../argv-normalization.js";

describe("normalizeCliArgv", () => {
  it("inserts -- before dash-prefixed tell thread ids", () => {
    expect(
      normalizeCliArgv(["node", "bb", "thread", "tell", "-thread-1", "hello"]),
    ).toEqual(["node", "bb", "thread", "tell", "--", "-thread-1", "hello"]);
  });

  it("preserves explicit separators", () => {
    expect(
      normalizeCliArgv(["node", "bb", "thread", "tell", "--", "-thread-1", "hello"]),
    ).toEqual(["node", "bb", "thread", "tell", "--", "-thread-1", "hello"]);
  });

  it("keeps flag options ahead of archive ids", () => {
    expect(
      normalizeCliArgv(["node", "bb", "thread", "archive", "--force", "-thread-1"]),
    ).toEqual(["node", "bb", "thread", "archive", "--force", "--", "-thread-1"]);
  });

  it("keeps option values intact before demote ids", () => {
    expect(
      normalizeCliArgv([
        "node",
        "bb",
        "thread",
        "demote",
        "--project",
        "proj-1",
        "-thread-1",
      ]),
    ).toEqual([
      "node",
      "bb",
      "thread",
      "demote",
      "--project",
      "proj-1",
      "--",
      "-thread-1",
    ]);
  });
});
