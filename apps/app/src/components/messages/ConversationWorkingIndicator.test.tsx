import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationWorkingIndicator } from "./ConversationWorkingIndicator";

describe("ConversationWorkingIndicator", () => {
  it("renders the default working label and spacing", () => {
    const markup = renderToStaticMarkup(<ConversationWorkingIndicator />);

    expect(markup).toContain("Working...");
    expect(markup).toContain("mt-4");
    expect(markup).toContain("animate-shine");
  });

  it("supports custom labels and spacing overrides", () => {
    const markup = renderToStaticMarkup(
      <ConversationWorkingIndicator label="Loading thread..." className="mt-6" />,
    );

    expect(markup).toContain("Loading thread...");
    expect(markup).toContain("mt-6");
    expect(markup).not.toContain("mt-4");
  });
});
