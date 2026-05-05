// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarFooter } from "../src/primitives/ui/sidebar.js";

function requireHTMLElement(
  value: Element | null,
  message: string,
): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error(message);
  }

  return value;
}

afterEach(() => {
  cleanup();
});

describe("SidebarFooter", () => {
  it("renders a plain footer without an overflow fade", () => {
    const view = render(<SidebarFooter>Footer actions</SidebarFooter>);

    screen.getByText("Footer actions");

    const footer = requireHTMLElement(
      view.container.querySelector('[data-sidebar="footer"]'),
      "Sidebar footer was not rendered",
    );

    expect(footer.classList.contains("relative")).toBe(false);
    expect(footer.classList.contains("bg-sidebar")).toBe(false);
    expect(footer.querySelector("[data-overflow-fade]")).toBeNull();
  });
});
