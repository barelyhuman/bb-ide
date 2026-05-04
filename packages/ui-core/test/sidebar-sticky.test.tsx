// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  SidebarStickyStack,
  SidebarStickyTier,
} from "../src/primitives/ui/sidebar.js";

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

describe("SidebarStickyStack", () => {
  it("renders a scoped sticky stack with labeled tiers and optional fades", () => {
    const view = render(
      <SidebarStickyStack>
        <SidebarStickyTier tier="label" showBelowFade>
          Projects
        </SidebarStickyTier>
        <SidebarStickyTier tier="project" showBelowFade={false}>
          Project Alpha
        </SidebarStickyTier>
      </SidebarStickyStack>,
    );

    const stack = requireHTMLElement(
      view.container.querySelector("[data-sidebar-sticky-stack]"),
      "Sticky stack was not rendered",
    );
    const label = requireHTMLElement(
      screen.getByText("Projects"),
      "Sticky label tier was not rendered",
    );
    const project = requireHTMLElement(
      screen.getByText("Project Alpha"),
      "Sticky project tier was not rendered",
    );

    expect(stack.getAttribute("data-sidebar")).toBe("group");
    expect(label.getAttribute("data-sidebar")).toBe("group-label");
    expect(label.getAttribute("data-sidebar-sticky-tier")).toBe("label");
    expect(project.getAttribute("data-sidebar-sticky-tier")).toBe("project");

    const labelFade = label.querySelector("[data-overflow-fade]");
    expect(labelFade?.getAttribute("data-overflow-fade")).toBe("below");
    expect(labelFade?.getAttribute("data-overflow-fade-tone")).toBe("sidebar");
    expect(project.querySelector("[data-overflow-fade]")).toBeNull();
  });
});
