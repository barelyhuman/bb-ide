/**
 * Shared vitest setup.
 *
 * jsdom doesn't implement `window.matchMedia`, `ResizeObserver`, or
 * `IntersectionObserver`. Several of our hooks and detail blocks
 * (`useMediaQuery`, `useHoverPopover`, `ToolCallDetailBlock` overflow probe,
 * `GitDiffCard` sticky-header sentinel) reach for them during mount; without
 * polyfills they throw in every test that indirectly renders such a component.
 */
if (typeof window !== "undefined" && !window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

if (typeof window !== "undefined" && !window.ResizeObserver) {
  window.ResizeObserver = class ResizeObserverPolyfill {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (typeof window !== "undefined" && !window.IntersectionObserver) {
  class IntersectionObserverPolyfill {
    readonly root: Element | Document | null = null;
    readonly rootMargin: string = "";
    readonly thresholds: readonly number[] = [];
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  window.IntersectionObserver =
    IntersectionObserverPolyfill as unknown as typeof IntersectionObserver;
}
