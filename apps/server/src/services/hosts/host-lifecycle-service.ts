import { createAsyncDeduper } from "../lib/async-deduper.js";
import { createAsyncLane } from "../lib/async-lane.js";

export interface HostLifecycleService {
  dispose(): void;
  hostDestroyDeduper: ReturnType<typeof createAsyncDeduper<string, void>>;
  hostLifecycleLane: ReturnType<typeof createAsyncLane<string>>;
}

export function createHostLifecycleService(): HostLifecycleService {
  const hostDestroyDeduper = createAsyncDeduper<string, void>();
  const hostLifecycleLane = createAsyncLane<string>();

  return {
    dispose() {
      hostDestroyDeduper.clear();
      hostLifecycleLane.clear();
    },
    hostDestroyDeduper,
    hostLifecycleLane,
  };
}
