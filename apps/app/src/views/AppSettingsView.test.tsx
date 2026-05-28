// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalOpenTargetSettingsSection } from "./AppSettingsView";

describe("LocalOpenTargetSettingsSection", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows readable daemon-unavailable copy inside the picker menu while preserving saved values", async () => {
    render(
      <LocalOpenTargetSettingsSection
        directoryTargetId="finder"
        fileTargetId="default-app"
        hasDaemon={false}
        onDirectoryTargetChange={vi.fn()}
        onFileTargetChange={vi.fn()}
        targets={[]}
      />,
    );

    const directoryPicker = screen.getByRole("button", {
      name: "Directory default",
    });

    expect(directoryPicker.textContent).toContain("Finder");
    expect(
      screen.queryByText(
        "This default can be changed when the local host daemon is available.",
      ),
    ).toBeNull();

    fireEvent.pointerDown(directoryPicker, {
      button: 0,
      ctrlKey: false,
    });

    const message = await screen.findByText(
      "This default can be changed when the local host daemon is available.",
    );
    expect(message.getAttribute("role")).toBe("note");
    expect(message.className).toContain("text-foreground");
    expect(message.getAttribute("data-disabled")).toBeNull();
  });
});
