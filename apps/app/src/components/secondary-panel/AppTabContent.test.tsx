// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import type { AppDetail, AppSummary } from "@bb/server-contract";
import * as api from "@/lib/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  threadAppQueryKey,
  threadAppsQueryKey,
} from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AppTabContent } from "./AppTabContent";

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();

  return {
    ...actual,
    getThreadApp: vi.fn(),
    getThreadAppMarkdownPreview: vi.fn(),
  };
});

const HTML_APP: AppDetail = {
  id: "status",
  name: "Status",
  entry: { path: "index.html", kind: "html" },
  capabilities: ["data", "message"],
  icon: { kind: "builtin", name: "ListTodo" },
};

const MARKDOWN_APP: AppDetail = {
  id: "readme",
  name: "Readme",
  entry: { path: "docs/index.md", kind: "md" },
  capabilities: [],
  icon: { kind: "builtin", name: "GridView" },
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("AppTabContent", () => {
  it("renders app-list metadata while the detail refetch is still pending", () => {
    vi.mocked(api.getThreadApp).mockReturnValue(new Promise(() => {}));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    queryClient.setQueryData<AppSummary[]>(threadAppsQueryKey("thr_1"), [
      HTML_APP,
    ]);

    render(<AppTabContent threadId="thr_1" appId="status" />, { wrapper });

    const frame = screen.getByTitle("Status");
    expect(frame.getAttribute("src")).toMatch(
      /^\/api\/v1\/threads\/thr_1\/apps\/status\/\?v=\d+$/u,
    );
    expect(api.getThreadApp).toHaveBeenCalledWith(
      "thr_1",
      "status",
      expect.any(AbortSignal),
    );
  });

  it("renders HTML apps in the injected app iframe route", async () => {
    vi.mocked(api.getThreadApp).mockResolvedValue(HTML_APP);
    const { wrapper } = createQueryClientTestHarness();

    render(<AppTabContent threadId="thr_1" appId="status" />, { wrapper });

    const frame = await screen.findByTitle("Status");
    expect(frame.getAttribute("src")).toMatch(
      /^\/api\/v1\/threads\/thr_1\/apps\/status\/\?v=\d+$/u,
    );
    expect(frame.getAttribute("sandbox")).toBeNull();
    expect(api.getThreadAppMarkdownPreview).not.toHaveBeenCalled();
  });

  it("reloads HTML app iframes when app detail data refreshes", async () => {
    vi.mocked(api.getThreadApp).mockReturnValue(new Promise(() => {}));
    const { queryClient, wrapper } = createQueryClientTestHarness();
    const appQueryKey = threadAppQueryKey("thr_1", "status");
    queryClient.setQueryData<AppDetail>(appQueryKey, HTML_APP, {
      updatedAt: 1_000,
    });

    render(<AppTabContent threadId="thr_1" appId="status" />, { wrapper });

    const firstFrame = screen.getByTitle("Status");
    const firstSrc = firstFrame.getAttribute("src");
    act(() => {
      queryClient.setQueryData<AppDetail>(
        appQueryKey,
        {
          ...HTML_APP,
          name: "Status",
        },
        {
          updatedAt: 2_000,
        },
      );
    });

    await waitFor(() => {
      expect(screen.getByTitle("Status").getAttribute("src")).not.toBe(
        firstSrc,
      );
    });
  });

  it("renders markdown apps through the static markdown preview path", async () => {
    vi.mocked(api.getThreadApp).mockResolvedValue(MARKDOWN_APP);
    vi.mocked(api.getThreadAppMarkdownPreview).mockResolvedValue({
      kind: "text",
      path: "docs/index.md",
      name: "index.md",
      url: "/api/v1/threads/thr_1/apps/readme/docs/index.md",
      mimeType: "text/markdown",
      content: "# App Notes\n\nStatic content.",
    });
    const { wrapper } = createQueryClientTestHarness();

    render(<AppTabContent threadId="thr_1" appId="readme" />, { wrapper });

    expect(await screen.findByText("App Notes")).toBeTruthy();
    expect(screen.getByText("Static content.")).toBeTruthy();
    expect(api.getThreadAppMarkdownPreview).toHaveBeenCalledWith(
      "thr_1",
      "readme",
      "docs/index.md",
      expect.any(AbortSignal),
    );
  });
});
