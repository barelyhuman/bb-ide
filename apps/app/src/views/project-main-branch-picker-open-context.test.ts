import { describe, expect, it } from "vitest";
import { isProjectMainBranchPickerOpenForContext } from "./project-main-branch-picker-open-context";

describe("isProjectMainBranchPickerOpenForContext", () => {
  it("keeps branch loading scoped to the project and environment that opened the picker", () => {
    const openedFor = {
      projectId: "project-1",
      environmentValue: "host:host-1:local",
    };

    expect(
      isProjectMainBranchPickerOpenForContext({
        openedFor,
        projectId: "project-1",
        environmentValue: "host:host-1:local",
      }),
    ).toBe(true);
    expect(
      isProjectMainBranchPickerOpenForContext({
        openedFor,
        projectId: "project-1",
        environmentValue: "host:host-2:local",
      }),
    ).toBe(false);
    expect(
      isProjectMainBranchPickerOpenForContext({
        openedFor,
        projectId: "project-2",
        environmentValue: "host:host-1:local",
      }),
    ).toBe(false);
  });
});
