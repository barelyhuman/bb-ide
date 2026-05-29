// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TERMINAL_PANEL_HEIGHT_PERCENT,
  EMPTY_THREAD_TERMINAL_PANEL_STATE,
  THREAD_TERMINAL_PANEL_IDLE_EXPIRY_MS,
  THREAD_TERMINAL_PANEL_STATE_STORAGE_VERSION,
  createEmptyThreadTerminalPanelState,
  getThreadTerminalPanelStateStorageKey,
  parseThreadTerminalPanelState,
  pruneThreadTerminalPanelStorage,
  serializeThreadTerminalPanelState,
  type ThreadTerminalPanelState,
} from "./thread-terminal-panel-state";

const NOW = 1_700_000_000_000;

interface LegacyThreadTerminalPanelState extends ThreadTerminalPanelState {
  activeTerminalId: string | null;
}

type ThreadTerminalPanelStateOverrides = Partial<ThreadTerminalPanelState>;
type LegacyThreadTerminalPanelStateOverrides =
  Partial<LegacyThreadTerminalPanelState>;

afterEach(() => {
  window.localStorage.clear();
});

function makeThreadTerminalPanelState(
  overrides: ThreadTerminalPanelStateOverrides = {},
): ThreadTerminalPanelState {
  return createEmptyThreadTerminalPanelState({
    isOpen: true,
    lastUsedAt: NOW,
    panelHeightPercent: 44,
    ...overrides,
  });
}

function makeLegacyThreadTerminalPanelState(
  overrides: LegacyThreadTerminalPanelStateOverrides = {},
): LegacyThreadTerminalPanelState {
  return {
    version: THREAD_TERMINAL_PANEL_STATE_STORAGE_VERSION,
    isOpen: true,
    activeTerminalId: "term_legacy",
    panelHeightPercent: DEFAULT_TERMINAL_PANEL_HEIGHT_PERCENT,
    lastUsedAt: NOW,
    ...overrides,
  };
}

describe("thread terminal panel state storage", () => {
  it("round-trips current state without an active terminal id", () => {
    const state = makeThreadTerminalPanelState();
    const storedValue = serializeThreadTerminalPanelState({ state });

    expect(storedValue).not.toContain("activeTerminalId");
    expect(
      parseThreadTerminalPanelState({
        initialValue: EMPTY_THREAD_TERMINAL_PANEL_STATE,
        now: NOW,
        storedValue,
      }),
    ).toEqual(state);
  });

  it("migrates legacy active terminal ids out of stored panel state", () => {
    const legacyState = makeLegacyThreadTerminalPanelState({
      activeTerminalId: "term_1",
      panelHeightPercent: 38,
    });

    expect(
      parseThreadTerminalPanelState({
        initialValue: EMPTY_THREAD_TERMINAL_PANEL_STATE,
        now: NOW,
        storedValue: JSON.stringify(legacyState),
      }),
    ).toEqual(
      makeThreadTerminalPanelState({
        isOpen: legacyState.isOpen,
        lastUsedAt: legacyState.lastUsedAt,
        panelHeightPercent: legacyState.panelHeightPercent,
      }),
    );
  });

  it("falls back for invalid current and legacy storage shapes", () => {
    const invalidStoredValues = [
      "{",
      JSON.stringify({ version: 1, isOpen: null }),
      JSON.stringify({
        ...makeThreadTerminalPanelState(),
        activeTerminalId: "",
      }),
    ];

    for (const storedValue of invalidStoredValues) {
      expect(
        parseThreadTerminalPanelState({
          initialValue: EMPTY_THREAD_TERMINAL_PANEL_STATE,
          now: NOW,
          storedValue,
        }),
      ).toBe(EMPTY_THREAD_TERMINAL_PANEL_STATE);
    }
  });

  it("expires legacy records after the idle window", () => {
    const expiredLegacyState = makeLegacyThreadTerminalPanelState({
      lastUsedAt: NOW - THREAD_TERMINAL_PANEL_IDLE_EXPIRY_MS - 1,
    });

    expect(
      parseThreadTerminalPanelState({
        initialValue: EMPTY_THREAD_TERMINAL_PANEL_STATE,
        now: NOW,
        storedValue: JSON.stringify(expiredLegacyState),
      }),
    ).toBe(EMPTY_THREAD_TERMINAL_PANEL_STATE);
  });

  it("prunes expired and invalid records without touching valid legacy storage", () => {
    const freshLegacyKey = getThreadTerminalPanelStateStorageKey({
      threadId: "thr-fresh-legacy",
    });
    const expiredKey = getThreadTerminalPanelStateStorageKey({
      threadId: "thr-expired",
    });
    const invalidKey = getThreadTerminalPanelStateStorageKey({
      threadId: "thr-invalid",
    });
    window.localStorage.setItem(
      freshLegacyKey,
      JSON.stringify(makeLegacyThreadTerminalPanelState()),
    );
    window.localStorage.setItem(
      expiredKey,
      serializeThreadTerminalPanelState({
        state: makeThreadTerminalPanelState({
          lastUsedAt: NOW - THREAD_TERMINAL_PANEL_IDLE_EXPIRY_MS - 1,
        }),
      }),
    );
    window.localStorage.setItem(invalidKey, "{");
    window.localStorage.setItem("bb.unrelated", "keep");

    pruneThreadTerminalPanelStorage({ now: NOW });

    expect(window.localStorage.getItem(freshLegacyKey)).not.toBeNull();
    expect(window.localStorage.getItem(expiredKey)).toBeNull();
    expect(window.localStorage.getItem(invalidKey)).toBeNull();
    expect(window.localStorage.getItem("bb.unrelated")).toBe("keep");
  });
});
