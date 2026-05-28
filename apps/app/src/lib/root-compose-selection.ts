import { atom, useAtom, useSetAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import type { ThreadCreationMode } from "@/components/promptbox/NewThreadPromptBox";
import {
  createLocalStorageEnumStorage,
  createLocalStorageSyncStorage,
} from "./browser-storage";

export type RootComposeMode = ThreadCreationMode;

const ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY = "bb.root-compose.project-id";
const ROOT_COMPOSE_MODE_STORAGE_KEY = "bb.promptbox.new-thread-mode";

function parseStoredProjectId(
  storedValue: string | null,
  initialValue: string,
): string {
  return storedValue && storedValue.length > 0 ? storedValue : initialValue;
}

function isThreadCreationMode(value: string): value is ThreadCreationMode {
  return value === "thread" || value === "manager";
}

const rootComposeProjectIdStorage = createLocalStorageSyncStorage<string>({
  parse: parseStoredProjectId,
  serialize: (value) => value,
});

const rootComposeModeStorage =
  createLocalStorageEnumStorage<ThreadCreationMode>(isThreadCreationMode);

const rootComposeProjectIdAtom = atomWithStorage<string>(
  ROOT_COMPOSE_PROJECT_ID_STORAGE_KEY,
  PERSONAL_PROJECT_ID,
  rootComposeProjectIdStorage,
  { getOnInit: true },
);

const storedRootComposeModeAtom = atomWithStorage<ThreadCreationMode>(
  ROOT_COMPOSE_MODE_STORAGE_KEY,
  "thread",
  rootComposeModeStorage,
  { getOnInit: true },
);

const rootComposeReuseEnvironmentAtom = atom<string | null>(null);

const rootComposeModeAtom = atom(
  (get) => get(storedRootComposeModeAtom),
  (_get, set, nextMode: ThreadCreationMode) => {
    set(storedRootComposeModeAtom, nextMode);
    if (nextMode === "manager") {
      set(rootComposeReuseEnvironmentAtom, null);
    }
  },
);

export function useRootComposeProjectId() {
  return useAtom(rootComposeProjectIdAtom);
}

export function useSetRootComposeProjectId() {
  return useSetAtom(rootComposeProjectIdAtom);
}

export function useRootComposeMode() {
  return useAtom(rootComposeModeAtom);
}

export function useSetRootComposeMode() {
  return useSetAtom(rootComposeModeAtom);
}

export function useRootComposeReuseEnvironment() {
  return useAtom(rootComposeReuseEnvironmentAtom);
}
