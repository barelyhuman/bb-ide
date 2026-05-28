// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MainViewBody } from "./MainView";

afterEach(cleanup);

describe("MainViewBody", () => {
  it("gives the no-projects empty state a semantic heading and create action", () => {
    render(
      <MainViewBody
        status="ready"
        isCreating={false}
        isAvailable={true}
        onCreate={vi.fn()}
        onRetry={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "No projects", level: 1 }),
    ).toBeTruthy();
    expect(
      screen.getByText("Create a new project to get started"),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "New project" })).toBeTruthy();
  });
});
