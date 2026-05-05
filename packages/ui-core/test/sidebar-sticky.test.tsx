// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  SidebarStickyStack,
  SidebarStickyTier,
} from "../src/primitives/ui/sidebar.js";

const THEME_CSS = readFileSync(
  "src/primitives/theme.css",
  "utf8",
);

interface CssRuleLookupArgs {
  cssText: string;
  selector: string;
}

function requireHTMLElement(
  value: Element | null,
  message: string,
): HTMLElement {
  if (!(value instanceof HTMLElement)) {
    throw new Error(message);
  }

  return value;
}

function getCssRuleBody({ cssText, selector }: CssRuleLookupArgs): string {
  const selectorIndex = cssText.indexOf(selector);
  if (selectorIndex === -1) {
    throw new Error(`${selector} rule was not found`);
  }

  const bodyStart = cssText.indexOf("{", selectorIndex);
  const bodyEnd = cssText.indexOf("}", bodyStart);
  if (bodyStart === -1 || bodyEnd === -1) {
    throw new Error(`${selector} rule body was not found`);
  }

  return cssText.slice(bodyStart + 1, bodyEnd);
}

function getCssRuleBodiesForSelector({
  cssText,
  selector,
}: CssRuleLookupArgs): string[] {
  const ruleBodies = cssText.split("}").flatMap((rule) => {
    const [selectorText, body] = rule.split("{");
    if (selectorText === undefined || body === undefined) return [];
    return selectorText.includes(selector) ? [body] : [];
  });

  if (ruleBodies.length === 0) {
    throw new Error(`${selector} rule was not found`);
  }

  return ruleBodies;
}

afterEach(() => {
  cleanup();
});

describe("SidebarStickyStack", () => {
  it("renders a scoped sticky stack with labeled tiers and no overflow fades", () => {
    const view = render(
      <SidebarStickyStack>
        <SidebarStickyTier tier="label">
          Projects
        </SidebarStickyTier>
        <SidebarStickyTier tier="project">
          Project Alpha
        </SidebarStickyTier>
        <SidebarStickyTier tier="manager" className="bg-sidebar-border">
          Manager Alpha
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
    const manager = requireHTMLElement(
      screen.getByText("Manager Alpha"),
      "Sticky manager tier was not rendered",
    );

    expect(stack.getAttribute("data-sidebar")).toBe("group");
    expect(label.getAttribute("data-sidebar")).toBe("group-label");
    expect(label.getAttribute("data-sidebar-sticky-tier")).toBe("label");
    expect(project.getAttribute("data-sidebar-sticky-tier")).toBe("project");
    expect(project.classList.contains("bg-sidebar")).toBe(true);
    expect(manager.getAttribute("data-sidebar-sticky-tier")).toBe("manager");
    expect(manager.classList.contains("bg-sidebar-border")).toBe(true);
    expect(manager.classList.contains("bg-sidebar")).toBe(false);
    expect(label.querySelector("[data-overflow-fade]")).toBeNull();
    expect(project.querySelector("[data-overflow-fade]")).toBeNull();
  });

  it("keeps sticky tier backgrounds class-mergeable", () => {
    const stickyTierRuleBody = getCssRuleBody({
      cssText: THEME_CSS,
      selector: "[data-sidebar-sticky-stack] [data-sidebar-sticky-tier]",
    });

    expect(stickyTierRuleBody).not.toMatch(/\bbackground(?:-color)?\s*:/u);
  });

  it("keeps sticky tier shields outside the row body", () => {
    const beforeRuleBodies = getCssRuleBodiesForSelector({
      cssText: THEME_CSS,
      selector:
        "[data-sidebar-sticky-stack] [data-sidebar-sticky-tier]::before",
    });
    const afterRuleBodies = getCssRuleBodiesForSelector({
      cssText: THEME_CSS,
      selector: "[data-sidebar-sticky-stack] [data-sidebar-sticky-tier]::after",
    });
    const joinedBeforeRuleBodies = beforeRuleBodies.join("\n");
    const joinedAfterRuleBodies = afterRuleBodies.join("\n");

    expect(joinedBeforeRuleBodies).not.toMatch(/\binset\s*:/u);
    expect(joinedAfterRuleBodies).not.toMatch(/\binset\s*:/u);
    expect(joinedBeforeRuleBodies).toContain("bottom: 100%");
    expect(joinedBeforeRuleBodies).toContain(
      "height: var(--bb-sidebar-sticky-tier-shield-top-height, 0)",
    );
    expect(joinedAfterRuleBodies).toContain("top: 100%");
    expect(joinedAfterRuleBodies).toContain(
      "height: var(--bb-sidebar-sticky-tier-shield-bottom-height, 0)",
    );
  });
});
