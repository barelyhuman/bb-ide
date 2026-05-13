// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectPathDialog } from "./ProjectPathDialog";

afterEach(() => {
  cleanup();
});

describe("ProjectPathDialog", () => {
  it("keeps validation errors visible until the path changes", async () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        platform="linux"
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "relative/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create project" }));

    expect(
      screen.getByText("Project path must be an absolute path."),
    ).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "/srv/repos/demo" },
    });

    await waitFor(() => {
      expect(
        screen.queryByText("Project path must be an absolute path."),
      ).toBeNull();
    });
  });

  it("submits the normalized path in update mode", async () => {
    const onSubmit = vi.fn();

    render(
      <ProjectPathDialog
        target={{
          currentPath: "/srv/repos/demo",
          kind: "update",
          projectId: "proj-1",
          projectName: "Demo",
        }}
        platform="linux"
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "/srv/repos/demo-updated/" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save path" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith(
        {
          currentPath: "/srv/repos/demo",
          kind: "update",
          projectId: "proj-1",
          projectName: "Demo",
        },
        "/srv/repos/demo-updated",
      );
    });
  });

});
