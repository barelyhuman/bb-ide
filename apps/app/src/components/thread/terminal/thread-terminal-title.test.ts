import { describe, expect, it } from "vitest";
import { normalizeTerminalTitle } from "./thread-terminal-title";

describe("terminal title normalization", () => {
  it("returns null for blank titles", () => {
    expect(normalizeTerminalTitle({ title: "  " })).toBeNull();
  });

  it("trims ordinary titles without changing their content", () => {
    expect(normalizeTerminalTitle({ title: "  Edited title  " })).toBe(
      "Edited title",
    );
  });

  it("collapses long shell path titles to their final path segments", () => {
    expect(
      normalizeTerminalTitle({
        title:
          "michael@Michaels-MacBook-Pro:~/.bb-dev/worktrees/env_gj4ep9emi8/bb",
      }),
    ).toBe(".../worktrees/env_gj4ep9emi8/bb");
  });

  it("keeps short shell path titles readable", () => {
    expect(
      normalizeTerminalTitle({
        title: "michael@host:~/bb",
      }),
    ).toBe("~/bb");
  });
});
