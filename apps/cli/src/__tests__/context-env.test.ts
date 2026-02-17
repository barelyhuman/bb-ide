import { afterEach, describe, expect, it } from "vitest";
import {
  requireProjectId,
  resolveProjectId,
  resolveTaskId,
  resolveThreadId,
} from "../context-env.js";

const CONTEXT_KEYS = ["BB_PROJECT_ID", "BB_TASK_ID", "BB_THREAD_ID"] as const;

afterEach(() => {
  for (const key of CONTEXT_KEYS) {
    delete process.env[key];
  }
});

describe("context env resolution", () => {
  it("prefers explicit project flag over env", () => {
    process.env.BB_PROJECT_ID = "proj-env";
    expect(resolveProjectId("proj-flag")).toBe("proj-flag");
  });

  it("uses BB_PROJECT_ID when project flag is missing", () => {
    process.env.BB_PROJECT_ID = "proj-env";
    expect(resolveProjectId(undefined)).toBe("proj-env");
  });

  it("requires a project value from flag or BB_PROJECT_ID", () => {
    expect(() => requireProjectId(undefined)).toThrow(
      "Missing project context. Pass --project <id> or set BB_PROJECT_ID.",
    );
  });

  it("reads BB_TASK_ID and BB_THREAD_ID defaults", () => {
    process.env.BB_TASK_ID = "task-env";
    process.env.BB_THREAD_ID = "thread-env";

    expect(resolveTaskId(undefined)).toBe("task-env");
    expect(resolveThreadId(undefined)).toBe("thread-env");
  });

  it("treats blank values as unset", () => {
    process.env.BB_PROJECT_ID = "   ";
    process.env.BB_TASK_ID = "";
    process.env.BB_THREAD_ID = " \t ";

    expect(resolveProjectId(undefined)).toBeUndefined();
    expect(resolveTaskId(undefined)).toBeUndefined();
    expect(resolveThreadId(undefined)).toBeUndefined();
  });
});
