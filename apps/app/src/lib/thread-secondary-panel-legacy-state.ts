import { z } from "zod";
import type {
  EnvironmentFilePreviewSource,
  HostFileTabState,
  WorkspaceFilePreviewStatusLabel,
  WorkspaceFileTabState,
} from "./file-preview";
import {
  areEnvironmentFilePreviewSourcesEqual,
} from "./file-preview";
import type { ThreadSecondaryPanel } from "./thread-secondary-panel";

export const LEGACY_THREAD_SECONDARY_PANEL_STORAGE_KEY =
  "bb.thread.secondaryPanel";
export const LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_PREFIX =
  "bb.thread.secondaryPanelState";
export const LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION = 1;
export const LEGACY_THREAD_SECONDARY_PANEL_IDLE_EXPIRY_MS =
  14 * 24 * 60 * 60 * 1000;

const threadSecondaryPanelSchema = z.enum(["git-diff", "thread-info"]);
const environmentFilePreviewSourceSchema: z.ZodType<EnvironmentFilePreviewSource> =
  z.discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("working-tree"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("head"),
      })
      .strict(),
    z
      .object({
        kind: z.literal("merge-base"),
        ref: z.string().min(1),
      })
      .strict(),
  ]);
const workspaceFilePreviewStatusLabelSchema: z.ZodType<WorkspaceFilePreviewStatusLabel | null> =
  z.literal("deleted").nullable();
const workspaceFileTabStateSchema = z
  .object({
    lineNumber: z.number().int().positive().nullable(),
    path: z.string().min(1),
    source: environmentFilePreviewSourceSchema,
    statusLabel: workspaceFilePreviewStatusLabelSchema,
  })
  .strict();
const hostFileTabStateSchema = z
  .object({
    lineNumber: z.number().int().positive().nullable(),
    path: z.string().min(1),
  })
  .strict();
const legacyThreadSecondaryPanelFileTabV1RefSchema = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("workspace"),
        path: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("storage"),
        path: z.string().min(1),
      })
      .strict(),
  ],
);
const legacyThreadSecondaryPanelFileTabRefSchema = z.discriminatedUnion(
  "type",
  [
    z
      .object({
        type: z.literal("workspace"),
        path: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("storage"),
        path: z.string().min(1),
      })
      .strict(),
    z
      .object({
        type: z.literal("host-file"),
        path: z.string().min(1),
      })
      .strict(),
  ],
);
const legacyThreadSecondaryPanelFileTabsStateSchema = z
  .object({
    workspace: z.array(workspaceFileTabStateSchema),
    storage: z.array(z.string().min(1)),
    hostFiles: z.array(hostFileTabStateSchema),
    active: legacyThreadSecondaryPanelFileTabRefSchema.nullable(),
  })
  .strict();
const legacyThreadSecondaryPanelFileTabsV1StateSchema = z
  .object({
    workspace: z.array(workspaceFileTabStateSchema),
    storage: z.array(z.string().min(1)),
    active: legacyThreadSecondaryPanelFileTabV1RefSchema.nullable(),
  })
  .strict();
const legacyThreadSecondaryPanelStateSchema = z
  .object({
    version: z.literal(LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION),
    activePanel: threadSecondaryPanelSchema.nullable(),
    environmentId: z.string().min(1).nullable(),
    fileTabs: legacyThreadSecondaryPanelFileTabsStateSchema,
    lastUsedAt: z.number().int().nonnegative(),
  })
  .strict();
const legacyThreadSecondaryPanelV1StateSchema = z
  .object({
    version: z.literal(LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION),
    activePanel: threadSecondaryPanelSchema.nullable(),
    environmentId: z.string().min(1).nullable(),
    fileTabs: legacyThreadSecondaryPanelFileTabsV1StateSchema,
    lastUsedAt: z.number().int().nonnegative(),
  })
  .strict();

interface ActiveWorkspaceFileTabRef {
  type: "workspace";
  path: string;
}

interface ActiveStorageFileTabRef {
  type: "storage";
  path: string;
}

interface ActiveHostFileTabRef {
  type: "host-file";
  path: string;
}

export type LegacyThreadSecondaryPanelFileTabRef =
  | ActiveWorkspaceFileTabRef
  | ActiveStorageFileTabRef
  | ActiveHostFileTabRef;

export interface LegacyThreadSecondaryPanelFileTabsState {
  workspace: readonly WorkspaceFileTabState[];
  storage: readonly string[];
  hostFiles: readonly HostFileTabState[];
  active: LegacyThreadSecondaryPanelFileTabRef | null;
}

export interface LegacyThreadSecondaryPanelState {
  version: typeof LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION;
  activePanel: ThreadSecondaryPanel | null;
  environmentId: string | null;
  fileTabs: LegacyThreadSecondaryPanelFileTabsState;
  lastUsedAt: number;
}

interface LegacyThreadSecondaryPanelStorageKeyArgs {
  threadId: string;
}

interface CreateLegacyThreadSecondaryPanelStateArgs {
  activePanel?: ThreadSecondaryPanel | null;
  environmentId?: string | null;
  fileTabs?: LegacyThreadSecondaryPanelFileTabsState;
  lastUsedAt?: number;
}

interface ParseLegacyThreadSecondaryPanelStateArgs {
  initialValue: LegacyThreadSecondaryPanelState;
  now: number;
  storedValue: string | null;
}

interface ParseLegacyThreadSecondaryPanelStateForStorageResult {
  shouldPrune: boolean;
  state: LegacyThreadSecondaryPanelState;
}

interface IsLegacyThreadSecondaryPanelStateExpiredArgs {
  now: number;
  state: LegacyThreadSecondaryPanelState;
}

interface NormalizeLegacyThreadSecondaryPanelStateArgs {
  isManagerThread: boolean;
  state: LegacyThreadSecondaryPanelState;
}

interface ReadLegacyThreadSecondaryPanelStateArgs {
  now: number;
  threadId: string;
}

interface RemoveLegacyThreadSecondaryPanelStateArgs {
  threadId: string;
}

interface PruneLegacyThreadSecondaryPanelStorageArgs {
  now: number;
}

function getLocalStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

function normalizeStorageSegment(value: string): string {
  return encodeURIComponent(value.trim());
}

function areWorkspaceFileTabsEqual(
  a: readonly WorkspaceFileTabState[],
  b: readonly WorkspaceFileTabState[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const aTab = a[i];
    const bTab = b[i];
    if (
      !aTab ||
      !bTab ||
      aTab.path !== bTab.path ||
      aTab.lineNumber !== bTab.lineNumber ||
      !areEnvironmentFilePreviewSourcesEqual(aTab.source, bTab.source) ||
      aTab.statusLabel !== bTab.statusLabel
    ) {
      return false;
    }
  }
  return true;
}

function areStorageFileTabsEqual(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function areHostFileTabsEqual(
  a: readonly HostFileTabState[],
  b: readonly HostFileTabState[],
): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const aTab = a[i];
    const bTab = b[i];
    if (
      !aTab ||
      !bTab ||
      aTab.path !== bTab.path ||
      aTab.lineNumber !== bTab.lineNumber
    ) {
      return false;
    }
  }
  return true;
}

function areActiveFileTabsEqual(
  a: LegacyThreadSecondaryPanelFileTabRef | null,
  b: LegacyThreadSecondaryPanelFileTabRef | null,
): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return a.type === b.type && a.path === b.path;
}

function findWorkspaceFileTab(
  tabs: readonly WorkspaceFileTabState[],
  path: string,
): WorkspaceFileTabState | null {
  return tabs.find((tab) => tab.path === path) ?? null;
}

function findHostFileTab(
  tabs: readonly HostFileTabState[],
  path: string,
): HostFileTabState | null {
  return tabs.find((tab) => tab.path === path) ?? null;
}

function dedupeWorkspaceFileTabs(
  tabs: readonly WorkspaceFileTabState[],
): WorkspaceFileTabState[] {
  const seenPaths = new Set<string>();
  const nextTabs: WorkspaceFileTabState[] = [];
  for (const tab of tabs) {
    if (seenPaths.has(tab.path)) continue;
    seenPaths.add(tab.path);
    nextTabs.push(tab);
  }
  return nextTabs;
}

function dedupeStorageFileTabs(tabs: readonly string[]): string[] {
  const seenPaths = new Set<string>();
  const nextTabs: string[] = [];
  for (const path of tabs) {
    if (seenPaths.has(path)) continue;
    seenPaths.add(path);
    nextTabs.push(path);
  }
  return nextTabs;
}

function dedupeHostFileTabs(
  tabs: readonly HostFileTabState[],
): HostFileTabState[] {
  const seenPaths = new Set<string>();
  const nextTabs: HostFileTabState[] = [];
  for (const tab of tabs) {
    if (seenPaths.has(tab.path)) continue;
    seenPaths.add(tab.path);
    nextTabs.push(tab);
  }
  return nextTabs;
}

function normalizeActiveFileTab(
  fileTabs: LegacyThreadSecondaryPanelFileTabsState,
  isManagerThread: boolean,
): LegacyThreadSecondaryPanelFileTabRef | null {
  const active = fileTabs.active;
  if (active === null) return null;
  if (active.type === "workspace") {
    return findWorkspaceFileTab(fileTabs.workspace, active.path) === null
      ? null
      : active;
  }
  if (active.type === "host-file") {
    return findHostFileTab(fileTabs.hostFiles, active.path) === null
      ? null
      : active;
  }
  if (!isManagerThread) return null;
  return fileTabs.storage.includes(active.path) ? active : null;
}

export function createEmptyLegacyThreadSecondaryPanelState(
  args: CreateLegacyThreadSecondaryPanelStateArgs = {},
): LegacyThreadSecondaryPanelState {
  return {
    version: LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION,
    activePanel: args.activePanel ?? null,
    environmentId: args.environmentId ?? null,
    fileTabs: args.fileTabs ?? {
      workspace: [],
      storage: [],
      hostFiles: [],
      active: null,
    },
    lastUsedAt: args.lastUsedAt ?? 0,
  };
}

export const EMPTY_LEGACY_THREAD_SECONDARY_PANEL_STATE =
  createEmptyLegacyThreadSecondaryPanelState();

export function getLegacyThreadSecondaryPanelStateStorageKey({
  threadId,
}: LegacyThreadSecondaryPanelStorageKeyArgs): string {
  return `${LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_PREFIX}-${normalizeStorageSegment(
    threadId,
  )}-${LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION}`;
}

function isLegacyThreadSecondaryPanelStateStorageKey(key: string): boolean {
  return (
    key.startsWith(`${LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_PREFIX}-`) &&
    key.endsWith(`-${LEGACY_THREAD_SECONDARY_PANEL_STATE_STORAGE_VERSION}`)
  );
}

function isLegacyThreadSecondaryPanelStateExpired({
  now,
  state,
}: IsLegacyThreadSecondaryPanelStateExpiredArgs): boolean {
  return now - state.lastUsedAt > LEGACY_THREAD_SECONDARY_PANEL_IDLE_EXPIRY_MS;
}

function parseLegacyThreadSecondaryPanelStateForStorage({
  initialValue,
  now,
  storedValue,
}: ParseLegacyThreadSecondaryPanelStateArgs): ParseLegacyThreadSecondaryPanelStateForStorageResult {
  if (storedValue === null) {
    return {
      shouldPrune: false,
      state: initialValue,
    };
  }

  let parsedValue: unknown;
  try {
    parsedValue = JSON.parse(storedValue);
  } catch {
    return {
      shouldPrune: true,
      state: initialValue,
    };
  }

  const stateResult =
    legacyThreadSecondaryPanelStateSchema.safeParse(parsedValue);
  if (stateResult.success) {
    if (
      isLegacyThreadSecondaryPanelStateExpired({
        now,
        state: stateResult.data,
      })
    ) {
      return {
        shouldPrune: true,
        state: initialValue,
      };
    }

    return {
      shouldPrune: false,
      state: stateResult.data,
    };
  }

  const legacyStateResult =
    legacyThreadSecondaryPanelV1StateSchema.safeParse(parsedValue);
  if (!legacyStateResult.success) {
    return {
      shouldPrune: true,
      state: initialValue,
    };
  }

  const migratedState: LegacyThreadSecondaryPanelState = {
    ...legacyStateResult.data,
    fileTabs: {
      ...legacyStateResult.data.fileTabs,
      hostFiles: [],
    },
  };

  if (isLegacyThreadSecondaryPanelStateExpired({ now, state: migratedState })) {
    return {
      shouldPrune: true,
      state: initialValue,
    };
  }

  return {
    shouldPrune: false,
    state: migratedState,
  };
}

export function parseLegacyThreadSecondaryPanelState({
  initialValue,
  now,
  storedValue,
}: ParseLegacyThreadSecondaryPanelStateArgs): LegacyThreadSecondaryPanelState {
  return parseLegacyThreadSecondaryPanelStateForStorage({
    initialValue,
    now,
    storedValue,
  }).state;
}

export function serializeLegacyThreadSecondaryPanelState(
  state: LegacyThreadSecondaryPanelState,
): string {
  return JSON.stringify(state);
}

export function normalizeLegacyThreadSecondaryPanelState({
  isManagerThread,
  state,
}: NormalizeLegacyThreadSecondaryPanelStateArgs): LegacyThreadSecondaryPanelState {
  const workspace = dedupeWorkspaceFileTabs(state.fileTabs.workspace);
  const storage = isManagerThread
    ? dedupeStorageFileTabs(state.fileTabs.storage)
    : [];
  const hostFiles = dedupeHostFileTabs(state.fileTabs.hostFiles);
  const fileTabs: LegacyThreadSecondaryPanelFileTabsState = {
    workspace,
    storage,
    hostFiles,
    active: normalizeActiveFileTab(
      {
        workspace,
        storage,
        hostFiles,
        active: state.fileTabs.active,
      },
      isManagerThread,
    ),
  };

  if (
    areWorkspaceFileTabsEqual(workspace, state.fileTabs.workspace) &&
    areStorageFileTabsEqual(storage, state.fileTabs.storage) &&
    areHostFileTabsEqual(hostFiles, state.fileTabs.hostFiles) &&
    areActiveFileTabsEqual(fileTabs.active, state.fileTabs.active)
  ) {
    return state;
  }

  return {
    ...state,
    fileTabs,
  };
}

export function readLegacyThreadSecondaryPanelState({
  now,
  threadId,
}: ReadLegacyThreadSecondaryPanelStateArgs): LegacyThreadSecondaryPanelState | null {
  const localStorage = getLocalStorage();
  if (!localStorage) return null;

  const storageKey = getLegacyThreadSecondaryPanelStateStorageKey({ threadId });
  const storedValue = localStorage.getItem(storageKey);
  const result = parseLegacyThreadSecondaryPanelStateForStorage({
    initialValue: EMPTY_LEGACY_THREAD_SECONDARY_PANEL_STATE,
    now,
    storedValue,
  });
  if (storedValue !== null && result.shouldPrune) {
    localStorage.removeItem(storageKey);
  }
  if (storedValue === null || result.shouldPrune) {
    return null;
  }
  return result.state;
}

export function removeLegacyThreadSecondaryPanelState({
  threadId,
}: RemoveLegacyThreadSecondaryPanelStateArgs): void {
  const localStorage = getLocalStorage();
  if (!localStorage) return;
  localStorage.removeItem(
    getLegacyThreadSecondaryPanelStateStorageKey({ threadId }),
  );
}

export function pruneLegacyThreadSecondaryPanelStorage({
  now,
}: PruneLegacyThreadSecondaryPanelStorageArgs): void {
  const localStorage = getLocalStorage();
  if (!localStorage) return;

  localStorage.removeItem(LEGACY_THREAD_SECONDARY_PANEL_STORAGE_KEY);

  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (!key || !isLegacyThreadSecondaryPanelStateStorageKey(key)) continue;
    const parseResult = parseLegacyThreadSecondaryPanelStateForStorage({
      initialValue: EMPTY_LEGACY_THREAD_SECONDARY_PANEL_STATE,
      now,
      storedValue: localStorage.getItem(key),
    });
    if (parseResult.shouldPrune) {
      keysToRemove.push(key);
    }
  }

  for (const key of keysToRemove) {
    localStorage.removeItem(key);
  }
}
