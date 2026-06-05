import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import type { Location } from "react-router-dom";

/**
 * One slot in the app-owned route history. `key` is React Router's
 * per-entry `location.key`, used to reconcile native/router POP movements
 * back to a known slot. `url` is the normalized `pathname + search + hash`
 * used to decide whether two slots are visibly the same route (duplicate
 * same-URL entries get distinct keys but share a `url`).
 */
export interface AppRouteHistoryEntry {
  key: string;
  url: string;
}

/**
 * The app-owned history stack and the index of the current slot. This mirrors
 * the React Router entries the app has actually visited while mounted —
 * including duplicate same-URL pushes — so Back/Forward can move by a real
 * router delta rather than by reconstructing URLs.
 */
export interface AppRouteHistoryState {
  entries: AppRouteHistoryEntry[];
  index: number;
}

export interface AppRouteHistoryNavigation {
  canGoBack: boolean;
  canGoForward: boolean;
  goBack: () => void;
  goForward: () => void;
}

/** The navigation kinds React Router reports for a location change. */
type AppRouteNavigationType = "POP" | "PUSH" | "REPLACE";

function getNormalizedUrl(location: Location): string {
  return `${location.pathname}${location.search}${location.hash}`;
}

/**
 * Index of the nearest earlier slot whose URL is visibly different from the
 * current slot, or null when none exists. Skipping equal-URL slots means one
 * Back click lands on a different route instead of a no-op duplicate.
 */
function findBackTargetIndex(state: AppRouteHistoryState): number | null {
  const currentUrl = state.entries[state.index]?.url;
  if (currentUrl === undefined) {
    return null;
  }
  for (let candidate = state.index - 1; candidate >= 0; candidate -= 1) {
    if (state.entries[candidate].url !== currentUrl) {
      return candidate;
    }
  }
  return null;
}

/** Forward counterpart of {@link findBackTargetIndex}. */
function findForwardTargetIndex(state: AppRouteHistoryState): number | null {
  const currentUrl = state.entries[state.index]?.url;
  if (currentUrl === undefined) {
    return null;
  }
  for (
    let candidate = state.index + 1;
    candidate < state.entries.length;
    candidate += 1
  ) {
    if (state.entries[candidate].url !== currentUrl) {
      return candidate;
    }
  }
  return null;
}

function reduceHistory(
  state: AppRouteHistoryState,
  navigationType: AppRouteNavigationType,
  entry: AppRouteHistoryEntry,
): AppRouteHistoryState {
  switch (navigationType) {
    case "PUSH": {
      // A new navigation after going back drops the forward stack.
      const entries = state.entries.slice(0, state.index + 1);
      entries.push(entry);
      return { entries, index: entries.length - 1 };
    }
    case "REPLACE": {
      const entries = state.entries.slice();
      entries[state.index] = entry;
      return { entries, index: state.index };
    }
    case "POP": {
      const matchedIndex = state.entries.findIndex(
        (candidate) => candidate.key === entry.key,
      );
      if (matchedIndex >= 0) {
        // Native/router Back/Forward into a slot we recorded: reconcile to it
        // and keep the surrounding entries so movement stays reversible.
        return { entries: state.entries, index: matchedIndex };
      }
      // POP to an unrecorded key landed outside the app-owned session (e.g. a
      // restored off-app history position). Treat the current route as the
      // history boundary rather than offering navigation into history we did
      // not record.
      return { entries: [entry], index: 0 };
    }
  }
}

/**
 * App-shell route history for the sidebar Back/Forward controls. Tracks the
 * React Router entries visited while mounted and exposes browser-style
 * navigation that skips duplicate same-URL slots and never steps into
 * history the app did not record. This is app-route history only; it does not
 * touch the in-thread browser tab history.
 */
export function useAppRouteHistoryNavigation(): AppRouteHistoryNavigation {
  const location = useLocation();
  const navigationType = useNavigationType();
  const navigate = useNavigate();

  const [state, setState] = useState<AppRouteHistoryState>(() => ({
    entries: [{ key: location.key, url: getNormalizedUrl(location) }],
    index: 0,
  }));

  // The current key is processed at init, so the effect only reacts to later
  // navigations. Without this guard the same transition could be re-applied
  // (e.g. effect re-runs) and double-push an entry.
  const lastKeyRef = useRef(location.key);
  // Mirror the committed state so the click handlers read the latest stack and
  // index without being re-created on every navigation.
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (lastKeyRef.current === location.key) {
      return;
    }
    lastKeyRef.current = location.key;
    setState((previous) =>
      reduceHistory(previous, navigationType, {
        key: location.key,
        url: getNormalizedUrl(location),
      }),
    );
  }, [location, navigationType]);

  const goBack = useCallback(() => {
    const current = stateRef.current;
    const target = findBackTargetIndex(current);
    if (target === null) {
      return;
    }
    void navigate(target - current.index);
  }, [navigate]);

  const goForward = useCallback(() => {
    const current = stateRef.current;
    const target = findForwardTargetIndex(current);
    if (target === null) {
      return;
    }
    void navigate(target - current.index);
  }, [navigate]);

  return {
    canGoBack: findBackTargetIndex(state) !== null,
    canGoForward: findForwardTargetIndex(state) !== null,
    goBack,
    goForward,
  };
}
