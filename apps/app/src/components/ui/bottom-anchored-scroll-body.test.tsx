// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BottomAnchoredScrollBody,
  type CapturedScrollPosition,
  useBottomAnchoredScroll,
} from "@/components/ui/bottom-anchored-scroll-body";

interface ScrollMetrics {
  scrollHeight: number;
  clientHeight: number;
  scrollTop: number;
}

interface TestRect {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

interface RenderBodyOptions {
  extraRowCount: number;
}

let nextAnimationFrameId = 1;
let animationFrameCallbacks = new Map<number, FrameRequestCallback>();
let requestAnimationFrameMock = vi.fn();
let cancelAnimationFrameMock = vi.fn();

class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = [];

  readonly callback: ResizeObserverCallback;
  readonly observeMock = vi.fn();
  readonly unobserveMock = vi.fn();
  readonly disconnectMock = vi.fn();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverMock.instances.push(this);
  }

  observe(target: Element, options?: ResizeObserverOptions) {
    this.observeMock(target, options);
  }

  unobserve(target: Element) {
    this.unobserveMock(target);
  }

  disconnect() {
    this.disconnectMock();
  }

  trigger() {
    this.callback([], this);
  }
}

function installAnimationFrameMocks() {
  animationFrameCallbacks = new Map();
  nextAnimationFrameId = 1;
  requestAnimationFrameMock = vi.fn((callback: FrameRequestCallback) => {
    const frameId = nextAnimationFrameId;
    nextAnimationFrameId += 1;
    animationFrameCallbacks.set(frameId, callback);
    return frameId;
  });
  cancelAnimationFrameMock = vi.fn((frameId: number) => {
    animationFrameCallbacks.delete(frameId);
  });

  vi.stubGlobal("requestAnimationFrame", requestAnimationFrameMock);
  vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrameMock);
}

function flushAnimationFrames(frameCount: number) {
  for (let index = 0; index < frameCount; index += 1) {
    const frameCallbacks = [...animationFrameCallbacks.entries()];
    animationFrameCallbacks.clear();
    for (const [, callback] of frameCallbacks) {
      callback(window.performance.now());
    }
  }
}

function setScrollMetrics(element: HTMLElement, metrics: ScrollMetrics) {
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    value: metrics.scrollHeight,
  });
  Object.defineProperty(element, "clientHeight", {
    configurable: true,
    value: metrics.clientHeight,
  });
  element.scrollTop = metrics.scrollTop;
}

function requireHTMLElement(element: Element | null) {
  if (!(element instanceof HTMLElement)) {
    throw new Error("Expected HTMLElement.");
  }
  return element;
}

function getResizeObserverInstance() {
  const instance = ResizeObserverMock.instances[0];
  if (!instance) {
    throw new Error("Expected ResizeObserver instance.");
  }
  return instance;
}

function buildDomRect(rect: TestRect): DOMRect {
  return new DOMRect(rect.left, rect.top, rect.width, rect.height);
}

function BottomAnchorProbe() {
  const bottomAnchor = useBottomAnchoredScroll();
  const targetRef = useRef<HTMLDivElement>(null);
  const capturedPositionRef = useRef<CapturedScrollPosition | null>(null);
  return (
    <div>
      <output aria-label="Bottom state">
        {bottomAnchor ? (bottomAnchor.isAtBottom ? "bottom" : "away") : "null"}
      </output>
      <div ref={targetRef}>Scroll target</div>
      {bottomAnchor ? (
        <>
          <button type="button" onClick={bottomAnchor.scrollToBottom}>
            Scroll to bottom
          </button>
          <button
            type="button"
            onClick={() => {
              if (targetRef.current) {
                bottomAnchor.scrollElementIntoView({
                  element: targetRef.current,
                });
              }
            }}
          >
            Scroll target into view
          </button>
          <button
            type="button"
            onClick={() => {
              capturedPositionRef.current =
                bottomAnchor.captureScrollPosition();
            }}
          >
            Capture scroll position
          </button>
          <button
            type="button"
            onClick={() => {
              capturedPositionRef.current?.release();
              capturedPositionRef.current = null;
            }}
          >
            Release scroll position
          </button>
        </>
      ) : null}
    </div>
  );
}

const DEFAULT_RENDER_BODY_OPTIONS: RenderBodyOptions = {
  extraRowCount: 0,
};

function renderBodyContent(options: RenderBodyOptions) {
  const extraRows = Array.from(
    { length: options.extraRowCount },
    (_item, index) => <div key={index}>Extra timeline row {index + 1}</div>,
  );

  return (
    <>
      <textarea aria-label="Prompt" />
      <BottomAnchoredScrollBody
        footer={<div>Footer</div>}
        maxWidthClassName="max-w-none"
        scrollAreaClassName="scroll-area"
      >
        <div>Timeline row</div>
        {extraRows}
        <BottomAnchorProbe />
      </BottomAnchoredScrollBody>
    </>
  );
}

function renderBody(options = DEFAULT_RENDER_BODY_OPTIONS) {
  const view = render(renderBodyContent(options));
  const getScrollArea = () =>
    requireHTMLElement(view.container.querySelector(".scroll-area"));

  const rerenderBody = (nextOptions: RenderBodyOptions) => {
    view.rerender(renderBodyContent(nextOptions));
  };

  return {
    rerenderBody,
    scrollArea: getScrollArea(),
    unmount: view.unmount,
  };
}

function getBottomState() {
  return screen.getByRole("status", { name: "Bottom state" }).textContent;
}

beforeEach(() => {
  ResizeObserverMock.instances = [];
  vi.stubGlobal("ResizeObserver", ResizeObserverMock);
  installAnimationFrameMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("BottomAnchoredScrollBody", () => {
  it("keeps bottom state when non-bottom scroll is not user initiated", () => {
    const { scrollArea } = renderBody();
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 400,
    });

    fireEvent.scroll(scrollArea);

    expect(getBottomState()).toBe("bottom");
  });

  it("leaves bottom state only when non-bottom scroll follows user intent", () => {
    const { scrollArea } = renderBody();
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 400,
    });

    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    expect(getBottomState()).toBe("away");
  });

  it("ignores scroll-intent keys typed into editable controls", () => {
    const { scrollArea } = renderBody();
    const textarea = screen.getByRole("textbox", { name: "Prompt" });
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 400,
    });

    fireEvent.keyDown(textarea, { key: "End" });
    fireEvent.scroll(scrollArea);

    expect(getBottomState()).toBe("bottom");
  });

  it("scrolls to the maximum offset and restores bottom state", () => {
    const { scrollArea } = renderBody();
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 400,
    });
    fireEvent.wheel(scrollArea);
    fireEvent.scroll(scrollArea);

    fireEvent.click(screen.getByRole("button", { name: "Scroll to bottom" }));

    expect(scrollArea.scrollTop).toBe(900);
    expect(getBottomState()).toBe("bottom");
  });

  it("keeps bottom state when scrolling an already visible element into view", () => {
    const { scrollArea } = renderBody();
    const target = screen.getByText("Scroll target");
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 900,
    });
    vi.spyOn(scrollArea, "getBoundingClientRect").mockReturnValue(
      buildDomRect({
        bottom: 100,
        height: 100,
        left: 0,
        right: 100,
        top: 0,
        width: 100,
      }),
    );
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue(
      buildDomRect({
        bottom: 40,
        height: 20,
        left: 0,
        right: 100,
        top: 20,
        width: 100,
      }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Scroll target into view" }),
    );

    expect(getBottomState()).toBe("bottom");
  });

  it("restores bottom after observed layout changes while sticking", () => {
    const { scrollArea } = renderBody();
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 900,
    });
    flushAnimationFrames(1);
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_200,
      clientHeight: 100,
      scrollTop: 900,
    });

    getResizeObserverInstance().trigger();
    flushAnimationFrames(1);

    expect(scrollArea.scrollTop).toBe(1_100);
  });

  it("preserves a captured scroll position through multiple height changes", () => {
    const { rerenderBody, scrollArea } = renderBody();
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 200,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Capture scroll position" }),
    );

    setScrollMetrics(scrollArea, {
      scrollHeight: 1_020,
      clientHeight: 100,
      scrollTop: 200,
    });
    rerenderBody({ extraRowCount: 1 });

    expect(scrollArea.scrollTop).toBe(200);

    setScrollMetrics(scrollArea, {
      scrollHeight: 1_500,
      clientHeight: 100,
      scrollTop: 200,
    });
    rerenderBody({ extraRowCount: 2 });

    expect(scrollArea.scrollTop).toBe(200);

    fireEvent.click(
      screen.getByRole("button", { name: "Release scroll position" }),
    );
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_600,
      clientHeight: 100,
      scrollTop: 200,
    });
    rerenderBody({ extraRowCount: 3 });

    expect(scrollArea.scrollTop).toBe(200);
  });

  it("overrides browser anchoring while a captured scroll position is pending", () => {
    const { rerenderBody, scrollArea } = renderBody();
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_000,
      clientHeight: 100,
      scrollTop: 400,
    });

    fireEvent.click(
      screen.getByRole("button", { name: "Capture scroll position" }),
    );
    setScrollMetrics(scrollArea, {
      scrollHeight: 1_200,
      clientHeight: 100,
      scrollTop: 600,
    });
    rerenderBody({ extraRowCount: 1 });
    getResizeObserverInstance().trigger();
    flushAnimationFrames(1);

    expect(scrollArea.scrollTop).toBe(400);
    expect(getBottomState()).toBe("away");
  });
});
