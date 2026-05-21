import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveNodeEnvironment,
  resolveScriptMode,
} from "../src/lib/script-config.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("script-config", () => {
  it("maps NODE_ENV values to script modes", () => {
    expect(resolveScriptMode("development")).toBe("dev");
    expect(resolveScriptMode("production")).toBe("prod");
    expect(resolveNodeEnvironment("dev")).toBe("development");
    expect(resolveNodeEnvironment("prod")).toBe("production");
  });

  it("treats unset and non-production NODE_ENV as dev", () => {
    expect(resolveScriptMode(undefined)).toBe("dev");
    expect(resolveScriptMode("")).toBe("dev");
    expect(resolveScriptMode("test")).toBe("dev");
  });
});
