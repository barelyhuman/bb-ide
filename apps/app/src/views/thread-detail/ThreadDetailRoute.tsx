import { WorkerPoolContextProvider } from "@pierre/diffs/react";
import {
  createDiffWorker,
  getDiffWorkerPoolSize,
} from "@/lib/diff-worker-pool";
import { ThreadDetailView } from "./ThreadDetailView";

const WORKER_POOL_OPTIONS = {
  workerFactory: createDiffWorker,
  poolSize: getDiffWorkerPoolSize(),
};
const HIGHLIGHTER_OPTIONS = {};

export default function ThreadDetailRoute() {
  return (
    <WorkerPoolContextProvider
      poolOptions={WORKER_POOL_OPTIONS}
      highlighterOptions={HIGHLIGHTER_OPTIONS}
    >
      <ThreadDetailView />
    </WorkerPoolContextProvider>
  );
}
