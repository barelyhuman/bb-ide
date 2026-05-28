// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectSelector, type ProjectSelectorOption } from "./ProjectSelector";

const projects: readonly ProjectSelectorOption[] = [
  { id: "proj_bb", name: "bb" },
  { id: "proj_pierre", name: "pierre" },
];

afterEach(() => {
  cleanup();
});

describe("ProjectSelector", () => {
  it("renders the no-project prompt when no project is selected", () => {
    render(
      <ProjectSelector
        projects={projects}
        value={null}
        onChange={vi.fn()}
        allowNoProject
      />,
    );

    const trigger = screen.getByRole("button", { name: "Project" });
    expect(trigger.textContent).toContain("Work in a project");
    expect(trigger.getAttribute("title")).toBe("Project: Work in a project");
  });

  it("emits null from the no-project option", () => {
    const onChange = vi.fn();
    render(
      <ProjectSelector
        projects={projects}
        value="proj_bb"
        onChange={onChange}
        allowNoProject
        defaultOpen
        modal={false}
      />,
    );

    fireEvent.click(
      screen.getByRole("menuitem", { name: "Don't work in a project" }),
    );

    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("shows a new-project action when there are no projects", () => {
    const onCreate = vi.fn();
    render(
      <ProjectSelector
        projects={[]}
        value={null}
        onChange={vi.fn()}
        allowNoProject
        createProject={{ onCreate }}
        defaultOpen
        modal={false}
      />,
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "New project" }));

    expect(onCreate).toHaveBeenCalledOnce();
  });

  it("does not show the new-project action when projects exist", () => {
    render(
      <ProjectSelector
        projects={projects}
        value={null}
        onChange={vi.fn()}
        allowNoProject
        createProject={{ onCreate: vi.fn() }}
        defaultOpen
        modal={false}
      />,
    );

    expect(screen.queryByRole("menuitem", { name: "New project" })).toBeNull();
  });

  it("does not render an orphan separator after the only new-project action", () => {
    render(
      <ProjectSelector
        projects={[]}
        value={null}
        onChange={vi.fn()}
        createProject={{ onCreate: vi.fn() }}
        defaultOpen
        modal={false}
      />,
    );

    expect(screen.getByRole("menuitem", { name: "New project" })).toBeTruthy();
    expect(screen.queryByRole("separator")).toBeNull();
  });
});
