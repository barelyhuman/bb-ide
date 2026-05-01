import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { createLocalStorageSyncStorage } from "./browser-storage";

const USE_STANDARD_MANAGER_TIMELINE_STORAGE_KEY =
  "bb.thread.useStandardManagerTimeline";

const useStandardManagerTimelineStorage = createLocalStorageSyncStorage<boolean>(
  {
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
  },
);

const useStandardManagerTimelineAtom = atomWithStorage<boolean>(
  USE_STANDARD_MANAGER_TIMELINE_STORAGE_KEY,
  false,
  useStandardManagerTimelineStorage,
  { getOnInit: true },
);

export function useStandardManagerTimelinePreference() {
  return useAtom(useStandardManagerTimelineAtom);
}
