// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserHistoryEntry } from "@/lib/browser-history";
import { BrowserNewTabScreen } from "./BrowserNewTabScreen";

interface RenderScreenArgs {
  recent?: readonly BrowserHistoryEntry[];
}

function renderScreen(args: RenderScreenArgs = {}) {
  const onNavigateInput = vi.fn();
  const onClearRecent = vi.fn();
  render(
    <BrowserNewTabScreen
      onNavigateInput={onNavigateInput}
      recent={args.recent ?? []}
      onClearRecent={onClearRecent}
    />,
  );
  return { onNavigateInput, onClearRecent };
}

afterEach(cleanup);

describe("BrowserNewTabScreen", () => {
  it("lists recently visited entries and opens one", () => {
    const now = Date.now();
    const recent: BrowserHistoryEntry[] = [
      {
        url: "https://example.com/a",
        title: "Example A",
        visitedAt: now - 90_000,
      },
      {
        url: "https://docs.test.dev",
        title: null,
        visitedAt: now - 3_600_000,
      },
    ];
    const { onNavigateInput } = renderScreen({ recent });

    const list = screen.getByRole("list", { name: "Recently visited" });
    expect(within(list).getByText("Example A")).toBeTruthy();
    // A null title falls back to the host, rendered once (no duplicate line).
    expect(within(list).getAllByText("docs.test.dev")).toHaveLength(1);

    fireEvent.click(within(list).getByRole("button", { name: /Example A/u }));

    expect(onNavigateInput).toHaveBeenCalledWith("https://example.com/a");
  });

  it("clears recently visited", () => {
    const recent: BrowserHistoryEntry[] = [
      { url: "https://example.com", title: "Example", visitedAt: Date.now() },
    ];
    const { onClearRecent } = renderScreen({ recent });

    fireEvent.click(
      screen.getByRole("button", { name: "Clear recently visited" }),
    );

    expect(onClearRecent).toHaveBeenCalledTimes(1);
  });

  it("omits the recently-visited section when there is no history", () => {
    renderScreen({ recent: [] });

    expect(screen.queryByText("Recently visited")).toBeNull();
  });

  it("drops the isolated-session tag", () => {
    renderScreen({
      recent: [{ url: "https://example.com", title: "Example", visitedAt: Date.now() }],
    });

    expect(screen.queryByText(/isolated session/iu)).toBeNull();
  });
});
