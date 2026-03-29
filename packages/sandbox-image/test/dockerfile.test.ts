import { describe, expect, it } from "vitest";
import { readSandboxImageDockerfile } from "../src/dockerfile.js";

describe("sandbox image dockerfile", () => {
  it("matches the checked-in snapshot", () => {
    expect(readSandboxImageDockerfile()).toMatchSnapshot();
  });
});
