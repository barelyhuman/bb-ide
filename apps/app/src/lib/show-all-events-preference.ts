import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createLocalStorageSyncStorage } from "./browser-storage";

const SHOW_ALL_EVENTS_STORAGE_KEY = "bb.thread.showAllEvents";

const showAllEventsStorage = createLocalStorageSyncStorage<boolean>({
  parse: (storedValue, initialValue) => {
    if (storedValue === "true") {
      return true;
    }
    if (storedValue === "false") {
      return false;
    }
    return initialValue;
  },
  serialize: (value) => String(value),
});

const showAllEventsAtom = atomWithStorage<boolean>(
  SHOW_ALL_EVENTS_STORAGE_KEY,
  false,
  showAllEventsStorage,
  { getOnInit: true },
);

export function useStoredShowAllEvents() {
  return useAtom(showAllEventsAtom);
}
