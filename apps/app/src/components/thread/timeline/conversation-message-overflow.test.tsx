// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConversationMessageOverflowToggle,
  useIsOverflowing,
} from "./conversation-message-overflow";

type ElementScrollMetricName = "clientHeight" | "scrollHeight";

interface OverflowHarnessProps {
  text: string;
}

interface ElementScrollMetricDescriptors {
  clientHeight: PropertyDescriptor | undefined;
  scrollHeight: PropertyDescriptor | undefined;
}

interface ElementScrollMetrics {
  clientHeight: number;
  scrollHeight: number;
}

function restoreElementScrollMetric(
  name: ElementScrollMetricName,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(HTMLElement.prototype, name, descriptor);
    return;
  }
  delete HTMLElement.prototype[name];
}

function installElementScrollMetrics({
  clientHeight,
  scrollHeight,
}: ElementScrollMetrics): ElementScrollMetricDescriptors {
  const descriptors: ElementScrollMetricDescriptors = {
    clientHeight: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    ),
    scrollHeight: Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollHeight",
    ),
  };

  Object.defineProperty(HTMLElement.prototype, "clientHeight", {
    configurable: true,
    get() {
      return clientHeight;
    },
  });
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get() {
      return scrollHeight;
    },
  });

  return descriptors;
}

function restoreElementScrollMetrics({
  clientHeight,
  scrollHeight,
}: ElementScrollMetricDescriptors): void {
  restoreElementScrollMetric("clientHeight", clientHeight);
  restoreElementScrollMetric("scrollHeight", scrollHeight);
}

function OverflowHarness({ text }: OverflowHarnessProps) {
  const [expanded, setExpanded] = useState(false);
  const textRef = useRef<HTMLDivElement>(null);
  const isOverflowing = useIsOverflowing({
    elementRef: textRef,
    enabled: !expanded,
    measurementKey: text,
  });
  const showToggle = expanded || isOverflowing;

  return (
    <div>
      <div ref={textRef}>{text}</div>
      {showToggle ? (
        <ConversationMessageOverflowToggle
          expanded={expanded}
          labels={{ collapsed: "Show more", expanded: "Show less" }}
          onToggle={() => setExpanded((current) => !current)}
        />
      ) : null}
    </div>
  );
}

afterEach(() => {
  cleanup();
});

describe("conversation message overflow", () => {
  it("shows the overflow toggle after measurement and switches labels when expanded", () => {
    const descriptors = installElementScrollMetrics({
      clientHeight: 20,
      scrollHeight: 100,
    });

    try {
      render(<OverflowHarness text="Line 1\nLine 2\nLine 3" />);

      const showMore = screen.getByRole("button", { name: "Show more" });
      expect(showMore.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(showMore);

      const showLess = screen.getByRole("button", { name: "Show less" });
      expect(showLess.getAttribute("aria-expanded")).toBe("true");

      fireEvent.click(showLess);

      expect(
        screen.getByRole("button", { name: "Show more" }),
      ).toBeTruthy();
    } finally {
      restoreElementScrollMetrics(descriptors);
    }
  });
});
