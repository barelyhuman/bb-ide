import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import type { ThreadCreationMode } from "@/components/promptbox/NewThreadPromptBox";
import { createLocalStorageEnumStorage } from "./browser-storage";

const NEW_THREAD_MODE_STORAGE_KEY = "bb.promptbox.new-thread-mode";

function isThreadCreationMode(value: string): value is ThreadCreationMode {
  return value === "thread" || value === "manager";
}

const newThreadModeStorage =
  createLocalStorageEnumStorage<ThreadCreationMode>(isThreadCreationMode);

const newThreadModeAtom = atomWithStorage<ThreadCreationMode>(
  NEW_THREAD_MODE_STORAGE_KEY,
  "thread",
  newThreadModeStorage,
  { getOnInit: true },
);

export function useNewThreadModePreference() {
  return useAtom(newThreadModeAtom);
}
