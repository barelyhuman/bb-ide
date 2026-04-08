export interface AsyncLane<TKey> {
  clear(): void;
  run<TValue>(key: TKey, task: () => Promise<TValue>): Promise<TValue>;
}

export function createAsyncLane<TKey>(): AsyncLane<TKey> {
  const tailByKey = new Map<TKey, Promise<void>>();

  return {
    clear() {
      tailByKey.clear();
    },
    async run(key, task) {
      const previous = tailByKey.get(key) ?? Promise.resolve();
      let release!: () => void;
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tailByKey.set(key, previous.catch(() => undefined).then(() => current));

      try {
        await previous.catch(() => undefined);
        return await task();
      } finally {
        release();
        if (tailByKey.get(key) === current) {
          tailByKey.delete(key);
        }
      }
    },
  };
}
