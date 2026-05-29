import { mkdirSync } from "node:fs";

export interface CrashDiagnosticsOptions {
  /** Directory the diagnostic report is written to (the data dir's `logs`). */
  logsDir: string;
}

/**
 * Enables Node diagnostic reports for fatal native/uncaught failures so the
 * daemon leaves a persisted crash report in the data-dir logs.
 */
export function enableCrashDiagnostics(options: CrashDiagnosticsOptions): void {
  mkdirSync(options.logsDir, { recursive: true });
  process.report.directory = options.logsDir;
  process.report.reportOnFatalError = true;
  process.report.reportOnUncaughtException = true;
}
