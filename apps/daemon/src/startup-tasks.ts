import type { Orchestrator } from "./orchestrator.js";

interface StartupTaskLogger {
  log(message: string): void;
  warn(message: string): void;
}

// Defer startup maintenance until the daemon is already serving requests.
export function scheduleManagedArtifactReconciliation(
  threadManager: Pick<Orchestrator, "reconcileManagedArtifacts">,
  logger: StartupTaskLogger = console,
): void {
  const task = setImmediate(() => {
    logger.log("Reconciling managed storage artifacts in background...");
    void threadManager.reconcileManagedArtifacts()
      .then(() => {
        logger.log("Managed artifact reconciliation complete.");
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(`Managed artifact cleanup skipped: ${message}`);
      });
  });
  task.unref();
}
