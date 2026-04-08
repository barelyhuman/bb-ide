export interface AsyncDeduper<TKey, TValue> {
  clear(): void;
  run(key: TKey, task: () => Promise<TValue>): Promise<TValue>;
}

export function createAsyncDeduper<TKey, TValue>(): AsyncDeduper<TKey, TValue> {
  const pendingByKey = new Map<TKey, Promise<TValue>>();

  return {
    clear() {
      pendingByKey.clear();
    },
    run(key, task) {
      const pendingTask = pendingByKey.get(key);
      if (pendingTask) {
        return pendingTask;
      }

      const startedTask = task().finally(() => {
        if (pendingByKey.get(key) === startedTask) {
          pendingByKey.delete(key);
        }
      });
      pendingByKey.set(key, startedTask);
      return startedTask;
    },
  };
}
