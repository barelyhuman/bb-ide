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
  it("anchors and blends the optional overflow fade", () => {
    const view = render(
      <SidebarFooter overflowFadePlacement="above">
        Footer actions
      </SidebarFooter>,
    );

    screen.getByText("Footer actions");

    const footer = requireHTMLElement(
      view.container.querySelector('[data-sidebar="footer"]'),
      "Sidebar footer was not rendered",
    );
    const fade = requireHTMLElement(
      footer.querySelector("[data-overflow-fade]"),
      "Sidebar footer fade was not rendered",
    );

    expect(footer.classList.contains("relative")).toBe(true);
    expect(footer.classList.contains("bg-sidebar")).toBe(true);
    expect(fade.getAttribute("data-overflow-fade")).toBe("above");
    expect(fade.getAttribute("data-overflow-fade-tone")).toBe("sidebar");
  });

  it("does not render an overflow fade unless requested", () => {
    const view = render(<SidebarFooter>Footer actions</SidebarFooter>);

    const footer = requireHTMLElement(
      view.container.querySelector('[data-sidebar="footer"]'),
      "Sidebar footer was not rendered",
    );

    expect(footer.querySelector("[data-overflow-fade]")).toBeNull();
  });
});
