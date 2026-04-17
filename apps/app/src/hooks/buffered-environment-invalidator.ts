import type { EnvironmentChangeKind } from "@bb/domain";

interface BufferedEnvironmentInvalidatorOptions {
  debounceMs: number;
  flushChangedEnvironmentIds: (
    changedEnvironments: Array<{
      changeKinds: EnvironmentChangeKind[];
      environmentId: string;
    }>,
  ) => void;
  maxWaitMs: number;
}

interface BufferedEnvironmentInvalidator {
  dispose: () => void;
  markChanged: (
    environmentId: string,
    changeKinds: readonly EnvironmentChangeKind[],
  ) => void;
}

export function createBufferedEnvironmentInvalidator(
  options: BufferedEnvironmentInvalidatorOptions,
): BufferedEnvironmentInvalidator {
  const changedEnvironmentKindsById = new Map<
    string,
    Set<EnvironmentChangeKind>
  >();
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
    if (changedEnvironmentKindsById.size === 0) {
      return;
    }
    options.flushChangedEnvironmentIds(
      Array.from(changedEnvironmentKindsById.entries()).map(
        ([environmentId, changeKinds]) => ({
          changeKinds: Array.from(changeKinds),
          environmentId,
        }),
      ),
    );
    changedEnvironmentKindsById.clear();
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
      changedEnvironmentKindsById.clear();
    },
    markChanged: (
      environmentId: string,
      changeKinds: readonly EnvironmentChangeKind[],
    ) => {
      let entry = changedEnvironmentKindsById.get(environmentId);
      if (!entry) {
        entry = new Set<EnvironmentChangeKind>();
        changedEnvironmentKindsById.set(environmentId, entry);
      }
      for (const changeKind of changeKinds) {
        entry.add(changeKind);
      }
      schedule();
    },
  };
}
