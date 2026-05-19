// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadSecondaryPanel } from "./ThreadSecondaryPanel";

interface RenderPanelArgs {
  onOpenFileSearch: () => void;
}

const noop = () => {};

function renderPanel({ onOpenFileSearch }: RenderPanelArgs) {
  const { wrapper } = createQueryClientTestHarness();
  return render(
    <ThreadSecondaryPanel
      activePanel="thread-info"
      canUseGitUi={false}
      environmentId={undefined}
      isOpen
      metadataContent={<div>Thread details</div>}
      onCollapse={noop}
      onClose={noop}
      onOpenFileSearch={onOpenFileSearch}
      onPanelChange={noop}
      onPanelFocus={noop}
      renderAsDrawer
      showGitDiffTab={false}
    />,
    { wrapper },
  );
}

afterEach(() => {
  cleanup();
});

describe("ThreadSecondaryPanel", () => {
  it("opens file search from the trailing plus menu", async () => {
    const onOpenFileSearch = vi.fn();

    renderPanel({ onOpenFileSearch });
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Add secondary panel tab" }),
      {
        button: 0,
        ctrlKey: false,
      },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Open file" }));

    expect(onOpenFileSearch).toHaveBeenCalledTimes(1);
  });
});
