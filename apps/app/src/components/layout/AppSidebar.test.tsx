// @vitest-environment jsdom

import { Suspense, type ReactNode } from "react";
import { act, cleanup, render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { SidebarProvider } from "@bb/ui-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QuickCreateProjectProvider } from "@/hooks/useQuickCreateProject";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { AppSidebar } from "./AppSidebar";

interface AppSidebarTestWrapperProps {
  children: ReactNode;
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

function createAppSidebarWrapper() {
  const harness = createQueryClientTestHarness();

  function AppSidebarWrapper({ children }: AppSidebarTestWrapperProps) {
    return harness.wrapper({
      children: (
        <Suspense fallback={null}>
          <BrowserRouter>
            <SidebarProvider>
              <QuickCreateProjectProvider>
                {children}
              </QuickCreateProjectProvider>
            </SidebarProvider>
          </BrowserRouter>
        </Suspense>
      ),
    });
  }

  return AppSidebarWrapper;
}

function installAppSidebarRoutes() {
  installFetchRoutes([
    {
      pathname: "/api/v1/projects",
      handler: () => jsonResponse([]),
    },
    {
      pathname: "/api/v1/system/config",
      handler: () =>
        jsonResponse({
          githubConnected: false,
          hostDaemonPort: null,
          sandboxHostSupported: false,
          voiceTranscriptionEnabled: false,
        }),
    },
    {
      pathname: "/api/v1/hosts",
      handler: () => jsonResponse([]),
    },
  ]);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AppSidebar", () => {
  it("renders the sidebar footer overflow fade", async () => {
    installAppSidebarRoutes();

    const wrapper = createAppSidebarWrapper();
    const view = await act(async () =>
      render(<AppSidebar onResizeMouseDown={vi.fn()} isResizing={false} />, {
        wrapper,
      }),
    );

    await screen.findByText("No projects");

    const footer = requireHTMLElement(
      view.container.querySelector('[data-sidebar="footer"]'),
      "Sidebar footer was not rendered",
    );

    const fade = footer.querySelector("[data-overflow-fade]");
    expect(fade?.getAttribute("data-overflow-fade")).toBe("above");
    expect(fade?.getAttribute("data-overflow-fade-tone")).toBe("sidebar");
  });
});
