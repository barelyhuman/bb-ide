import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ConversationStatusIndicator } from "./ConversationStatusIndicator";

describe("ConversationStatusIndicator", () => {
  it("renders the shared shimmering status treatment", () => {
    const markup = renderToStaticMarkup(
      <ConversationStatusIndicator label="Provisioning..." className="mt-4" />,
    );

    expect(markup).toContain("Provisioning...");
    expect(markup).toContain("animate-shine");
    expect(markup).toContain("px-2");
    expect(markup).toContain("text-sm");
    expect(markup).toContain("text-muted-foreground");
    expect(markup).toContain("mt-4");
  });
});
