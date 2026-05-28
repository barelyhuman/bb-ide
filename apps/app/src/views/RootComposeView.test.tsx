// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { RootComposeRoute } from "./RootComposeView";

function LocationCapture() {
  const location = useLocation();
  return <div data-testid="pathname">{location.pathname}</div>;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("RootComposeRoute", () => {
  it("redirects the personal legacy project route to root compose", async () => {
    render(
      <MemoryRouter initialEntries={[`/projects/${PERSONAL_PROJECT_ID}`]}>
        <Routes>
          <Route path="/projects/:projectId" element={<RootComposeRoute />} />
          <Route path="/" element={<LocationCapture />} />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("pathname").textContent).toBe("/");
    });
    expect(screen.queryByText("Not found")).toBeNull();
    expect(window.localStorage.getItem("bb.root-compose.project-id")).toBe(
      PERSONAL_PROJECT_ID,
    );
  });
});
