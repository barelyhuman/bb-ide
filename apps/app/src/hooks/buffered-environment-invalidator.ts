interface BufferedEnvironmentInvalidatorOptions {
  debounceMs: number;
  flushChangedEnvironmentIds: (environmentIds: string[]) => void;
  maxWaitMs: number;
}

interface BufferedEnvironmentInvalidator {
  dispose: () => void;
  markChanged: (environmentId: string) => void;
}

export function createBufferedEnvironmentInvalidator(
  options: BufferedEnvironmentInvalidatorOptions,
): BufferedEnvironmentInvalidator {
  const changedEnvironmentIds = new Set<string>();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
    if (changedEnvironmentIds.size === 0) {
      return;
    }
    options.flushChangedEnvironmentIds(Array.from(changedEnvironmentIds));
    changedEnvironmentIds.clear();
  };

  const schedule = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(flush, options.debounceMs);

    if (maxWaitTimer === null) {
      maxWaitTimer = setTimeout(flush, options.maxWaitMs);
    }
  };

  return {
    dispose: () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      if (maxWaitTimer !== null) {
        clearTimeout(maxWaitTimer);
        maxWaitTimer = null;
      }
      changedEnvironmentIds.clear();
    },
    markChanged: (environmentId: string) => {
      changedEnvironmentIds.add(environmentId);
      schedule();
    },
  };
}
