// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { ProjectPathDialog } from "./ProjectPathDialog"

afterEach(() => {
  cleanup()
})

describe("ProjectPathDialog", () => {
  it("keeps validation errors visible until the path changes", async () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        pickFolder={null}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "relative/path" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create project" }))

    expect(
      screen.getByText("Project path must be an absolute Linux or WSL path."),
    ).toBeTruthy()

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "/srv/repos/demo" },
    })

    await waitFor(() => {
      expect(
        screen.queryByText("Project path must be an absolute Linux or WSL path."),
      ).toBeNull()
    })
  })

  it("shows the native folder picker button only when the host supports it", () => {
    const { rerender } = render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        pickFolder={null}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    expect(screen.queryByRole("button", { name: "Choose folder" })).toBeNull()

    rerender(
      <ProjectPathDialog
        target={{ kind: "create" }}
        pickFolder={async () => "/srv/repos/demo"}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    screen.getByRole("button", { name: "Choose folder" })
  })

  it("normalizes picked folder paths before showing them", async () => {
    const pickFolder = vi.fn(async () => "/srv/repos/demo/")

    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        pickFolder={pickFolder}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Choose folder" }))

    await waitFor(() => {
      screen.getByDisplayValue("/srv/repos/demo")
    })
    expect(pickFolder).toHaveBeenCalledTimes(1)
  })

  it("shows the filesystem root validation message for create mode", () => {
    render(
      <ProjectPathDialog
        target={{ kind: "create" }}
        pickFolder={null}
        onOpenChange={() => {}}
        onSubmit={() => {}}
      />,
    )

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "/" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Create project" }))

    expect(
      screen.getByText("Project path must point to a project directory, not the filesystem root."),
    ).toBeTruthy()
  })

  it("submits the normalized path in update mode", async () => {
    const onSubmit = vi.fn()

    render(
      <ProjectPathDialog
        target={{
          currentPath: "/srv/repos/demo",
          kind: "update",
          projectId: "proj-1",
          projectName: "Demo",
        }}
        pickFolder={null}
        onOpenChange={() => {}}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByLabelText("Project path"), {
      target: { value: "/srv/repos/demo-updated/" },
    })
    fireEvent.click(screen.getByRole("button", { name: "Save path" }))

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith({
        currentPath: "/srv/repos/demo",
        kind: "update",
        projectId: "proj-1",
        projectName: "Demo",
      }, "/srv/repos/demo-updated")
    })
  })
})
