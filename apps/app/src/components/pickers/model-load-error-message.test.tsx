// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { SystemExecutionOptionsModelLoadError } from "@bb/server-contract";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatModelLoadErrorText,
  ModelLoadErrorMessage,
} from "./model-load-error-message";

const CODEX_CLI_URL = "https://developers.openai.com/codex/cli";

afterEach(() => {
  cleanup();
});

describe("ModelLoadErrorMessage", () => {
  it("links stable Codex CLI guidance for Codex missing executable errors", () => {
    const error: SystemExecutionOptionsModelLoadError = {
      providerId: "codex",
      code: "missing_executable",
    };

    const { container } = render(
      <ModelLoadErrorMessage error={error} providerLabel="OpenAI Codex" />,
    );

    const links = screen.getAllByRole("link", { name: "Codex CLI" });
    expect(links).toHaveLength(1);
    const link = screen.getByRole("link", { name: "Codex CLI" });
    expect(link.getAttribute("href")).toBe(CODEX_CLI_URL);
    expect(container.textContent).toBe(
      "Could not load models for OpenAI Codex. Please make sure the Codex CLI is installed.",
    );
  });

  it("formats Codex missing executable text without deriving the CLI name from the provider label", () => {
    const error: SystemExecutionOptionsModelLoadError = {
      providerId: "codex",
      code: "missing_executable",
    };

    expect(
      formatModelLoadErrorText({
        error,
        providerLabel: "OpenAI Codex",
      }),
    ).toBe(
      "Could not load models for OpenAI Codex. Please make sure the Codex CLI is installed.",
    );
  });

  it.each([
    {
      providerId: "claude-code",
      providerLabel: "Claude Code",
      expectedText: "Could not load models for Claude Code.",
    },
    {
      providerId: "pi",
      providerLabel: "Pi",
      expectedText: "Could not load models for Pi.",
    },
  ])(
    "renders plain generic copy for $providerLabel missing executable errors",
    ({ providerId, providerLabel, expectedText }) => {
      const error: SystemExecutionOptionsModelLoadError = {
        providerId,
        code: "missing_executable",
      };

      render(
        <ModelLoadErrorMessage error={error} providerLabel={providerLabel} />,
      );

      expect(screen.getByText(expectedText)).toBeTruthy();
      expect(screen.queryByRole("link")).toBeNull();
    },
  );
});
