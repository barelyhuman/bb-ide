import {
  createAsyncDeduper,
  type AsyncDeduper,
} from "./services/lib/async-deduper.js";

export interface LifecycleDedupers {
  sandboxBootstrap: AsyncDeduper<string, void>;
  threadProvisionAdvance: AsyncDeduper<string, void>;
}

export function createLifecycleDedupers(): LifecycleDedupers {
  return {
    sandboxBootstrap: createAsyncDeduper<string, void>(),
    threadProvisionAdvance: createAsyncDeduper<string, void>(),
  };
}
