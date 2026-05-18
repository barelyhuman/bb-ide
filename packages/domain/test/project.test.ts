import { describe, expect, it } from "vitest";
import { findLocalPathProjectSourceForHost } from "../src/project.js";

describe("project sources", () => {
  it("finds the local_path source for the requested host", () => {
    const source = findLocalPathProjectSourceForHost(
      [
        {
          createdAt: 1,
          hostId: "host_other",
          id: "src_other",
          isDefault: false,
          path: "/tmp/other",
          projectId: "proj_1",
          type: "local_path",
          updatedAt: 1,
        },
        {
          createdAt: 1,
          hostId: "host_local",
          id: "src_local",
          isDefault: true,
          path: "/tmp/local",
          projectId: "proj_1",
          type: "local_path",
          updatedAt: 1,
        },
      ],
      "host_local",
    );

    expect(source).toMatchObject({
      hostId: "host_local",
      id: "src_local",
      path: "/tmp/local",
      type: "local_path",
    });
  });
});
