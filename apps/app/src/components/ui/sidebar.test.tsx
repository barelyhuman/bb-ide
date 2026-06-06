// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COMPACT_VIEWPORT_QUERY } from "@/components/ui/hooks/use-compact-viewport";
import { Sidebar, SidebarProvider } from "@/components/ui/sidebar";
import {
  restoreMatchMedia,
  setupMatchMedia,
} from "@/test/helpers/match-media.js";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  restoreMatchMedia();
});

describe("Sidebar", () => {
  it("keeps sidebar children mounted when the mobile breakpoint changes", () => {
    const environment = setupMatchMedia();
    let mountCount = 0;
    let unmountCount = 0;

    function SidebarChildProbe() {
      useEffect(() => {
        mountCount += 1;
        return () => {
          unmountCount += 1;
        };
      }, []);

      return <div>Sidebar child</div>;
    }

    render(
      <SidebarProvider>
        <Sidebar>
          <SidebarChildProbe />
        </Sidebar>
      </SidebarProvider>,
    );

    expect(screen.getByText("Sidebar child")).toBeTruthy();
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    act(() => {
      environment.mediaQueryFor(COMPACT_VIEWPORT_QUERY).setMatches(true);
    });

    expect(screen.getByText("Sidebar child")).toBeTruthy();
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);

    act(() => {
      environment.mediaQueryFor(COMPACT_VIEWPORT_QUERY).setMatches(false);
    });

    expect(screen.getByText("Sidebar child")).toBeTruthy();
    expect(mountCount).toBe(1);
    expect(unmountCount).toBe(0);
  });

  it("uses the vertical seam token for desktop panel boundaries", () => {
    render(
      <SidebarProvider>
        <Sidebar>
          <div>Left sidebar child</div>
        </Sidebar>
        <Sidebar side="right">
          <div>Right sidebar child</div>
        </Sidebar>
      </SidebarProvider>,
    );

    const leftPanel = screen
      .getByText("Left sidebar child")
      .closest("[data-sidebar='panel']");
    const rightPanel = screen
      .getByText("Right sidebar child")
      .closest("[data-sidebar='panel']");

    expect(leftPanel?.className).toContain(
      "md:group-data-[side=left]:border-r",
    );
    expect(leftPanel?.className).toContain("md:border-border-seam-vertical");
    expect(rightPanel?.className).toContain(
      "md:group-data-[side=right]:border-l",
    );
    expect(rightPanel?.className).toContain("md:border-border-seam-vertical");
  });
});
