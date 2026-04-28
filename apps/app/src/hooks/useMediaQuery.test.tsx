// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

interface MatchMediaSetupOptions {
  readonly matchesByQuery?: ReadonlyMap<string, boolean>;
}

interface MatchMediaTestEnvironment {
  readonly mediaQueries: ReadonlyMap<string, FakeMediaQueryList>;
  readonly queries: readonly string[];
  mediaQueryFor: (query: string) => FakeMediaQueryList;
}

interface FakeMediaQueryListArgs {
  readonly matches: boolean;
  readonly media: string;
}

interface MediaQueryProbeProps {
  query: string;
  useMediaQuery: (query: string) => boolean;
}

type MediaQueryChangeListener = (
  this: MediaQueryList,
  event: MediaQueryListEvent,
) => void;

type MediaQueryEventListener<K extends keyof MediaQueryListEventMap> = (
  this: MediaQueryList,
  event: MediaQueryListEventMap[K],
) => void;

class FakeMediaQueryList extends EventTarget implements MediaQueryList {
  readonly media: string;
  matches: boolean;
  onchange: MediaQueryChangeListener | null = null;

  addEventListenerCallCount = 0;
  removeEventListenerCallCount = 0;

  constructor(args: FakeMediaQueryListArgs) {
    super();
    this.media = args.media;
    this.matches = args.matches;
  }

  addListener(callback: MediaQueryChangeListener | null): void {
    if (callback === null) return;
    this.addEventListener("change", callback);
  }

  removeListener(callback: MediaQueryChangeListener | null): void {
    if (callback === null) return;
    this.removeEventListener("change", callback);
  }

  addEventListener<K extends keyof MediaQueryListEventMap>(
    type: K,
    listener: MediaQueryEventListener<K> | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ): void {
    if (type === "change" && listener !== null) {
      this.addEventListenerCallCount += 1;
    }
    super.addEventListener(type, listener, options);
  }

  removeEventListener<K extends keyof MediaQueryListEventMap>(
    type: K,
    listener: MediaQueryEventListener<K> | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions,
  ): void {
    if (type === "change" && listener !== null) {
      this.removeEventListenerCallCount += 1;
    }
    super.removeEventListener(type, listener, options);
  }

  setMatches(matches: boolean): void {
    this.matches = matches;
    this.dispatchEvent(new Event("change"));
  }
}

const originalMatchMedia = window.matchMedia;

function setupMatchMedia(
  options: MatchMediaSetupOptions = {},
): MatchMediaTestEnvironment {
  const mediaQueries = new Map<string, FakeMediaQueryList>();
  const queries: string[] = [];

  function mediaQueryFor(query: string): FakeMediaQueryList {
    let mediaQuery = mediaQueries.get(query);
    if (mediaQuery) return mediaQuery;

    mediaQuery = new FakeMediaQueryList({
      matches: options.matchesByQuery?.get(query) ?? false,
      media: query,
    });
    mediaQueries.set(query, mediaQuery);
    return mediaQuery;
  }

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value(query: string): MediaQueryList {
      queries.push(query);
      return mediaQueryFor(query);
    },
  });

  return { mediaQueries, queries, mediaQueryFor };
}

describe("useMediaQuery", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("shares one browser listener per query and fans out changes", async () => {
    const query = "(pointer: coarse)";
    const environment = setupMatchMedia();
    const { useMediaQuery } = await import("./useMediaQuery");

    const first = renderHook(() => useMediaQuery(query));
    const second = renderHook(() => useMediaQuery(query));
    const mediaQuery = environment.mediaQueryFor(query);

    expect(first.result.current).toBe(false);
    expect(second.result.current).toBe(false);
    expect(mediaQuery.addEventListenerCallCount).toBe(1);

    act(() => {
      mediaQuery.setMatches(true);
    });

    expect(first.result.current).toBe(true);
    expect(second.result.current).toBe(true);

    first.unmount();
    expect(mediaQuery.removeEventListenerCallCount).toBe(0);

    second.unmount();
    expect(mediaQuery.removeEventListenerCallCount).toBe(1);
  });

  it("keeps independent subscriptions for independent queries", async () => {
    const coarseQuery = "(pointer: coarse)";
    const mobileQuery = "(max-width: 767px)";
    const environment = setupMatchMedia();
    const { useMediaQuery } = await import("./useMediaQuery");

    const coarse = renderHook(() => useMediaQuery(coarseQuery));
    const mobile = renderHook(() => useMediaQuery(mobileQuery));
    const coarseMediaQuery = environment.mediaQueryFor(coarseQuery);
    const mobileMediaQuery = environment.mediaQueryFor(mobileQuery);

    expect(coarseMediaQuery.addEventListenerCallCount).toBe(1);
    expect(mobileMediaQuery.addEventListenerCallCount).toBe(1);

    act(() => {
      mobileMediaQuery.setMatches(true);
    });

    expect(coarse.result.current).toBe(false);
    expect(mobile.result.current).toBe(true);
  });

  it("uses the server fallback snapshot during server rendering", async () => {
    const query = "(pointer: coarse)";
    const environment = setupMatchMedia({
      matchesByQuery: new Map<string, boolean>([[query, true]]),
    });
    const { useMediaQuery } = await import("./useMediaQuery");

    function MediaQueryProbe({
      query,
      useMediaQuery,
    }: MediaQueryProbeProps) {
      return <span>{String(useMediaQuery(query))}</span>;
    }

    expect(
      renderToString(
        <MediaQueryProbe query={query} useMediaQuery={useMediaQuery} />,
      ),
    ).toBe("<span>false</span>");
    expect(environment.queries).toHaveLength(0);
  });
});

describe("usePointerCoarse", () => {
  afterEach(() => {
    cleanup();
    vi.resetModules();
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it("uses the coarse pointer media query", async () => {
    const matchesByQuery = new Map<string, boolean>([
      ["(pointer: coarse)", true],
    ]);
    const environment = setupMatchMedia({ matchesByQuery });
    const { POINTER_COARSE_QUERY, usePointerCoarse } = await import(
      "./usePointerCoarse"
    );

    const coarse = renderHook(() => usePointerCoarse());

    expect(POINTER_COARSE_QUERY).toBe("(pointer: coarse)");
    expect(coarse.result.current).toBe(true);
    expect(environment.queries).toContain("(pointer: coarse)");
  });
});
