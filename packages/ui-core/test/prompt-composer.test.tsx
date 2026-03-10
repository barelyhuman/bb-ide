import { Children, isValidElement } from "react";
import { describe, expect, it } from "vitest";
import { PromptComposerShell } from "../src/prompt-composer.js";

describe("PromptComposerShell", () => {
  it("renders custom status content above the composer", () => {
    const element = PromptComposerShell({
      statusLabel: <div className="custom-status">Provisioning...</div>,
      children: <div>composer</div>,
    });
    const children = Children.toArray(isValidElement(element) ? element.props.children : []);
    const [status, composer] = children;

    expect(isValidElement(status)).toBe(true);
    expect(isValidElement(status) && status.props.className).toBe("custom-status");
    expect(isValidElement(status) && status.props.children).toBe("Provisioning...");
    expect(isValidElement(composer)).toBe(true);
    expect(isValidElement(composer) && composer.props.children).toBe("composer");
  });

  it("keeps legacy string status labels wrapped in the default muted styles", () => {
    const element = PromptComposerShell({
      statusLabel: "Provisioning...",
      children: <div>composer</div>,
    });
    const children = Children.toArray(isValidElement(element) ? element.props.children : []);
    const [status] = children;

    expect(isValidElement(status)).toBe(true);
    expect(isValidElement(status) && status.props.className).toContain("text-xs");
    expect(isValidElement(status) && status.props.className).toContain("text-muted-foreground");
    expect(isValidElement(status) && status.props.children).toBe("Provisioning...");
  });
});
