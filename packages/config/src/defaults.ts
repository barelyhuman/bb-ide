/**
 * Plain default values for all BB configuration.
 *
 * Zero dependencies — safe to import from vite.config.ts, build scripts,
 * or anywhere else that can't depend on envsafe or Node builtins.
 *
 * @bb/config uses these as its envsafe default/devDefault values.
 */

export const DEFAULTS = {
  dataDir: { prod: ".bb", dev: ".bb-dev" },
  logFormat: { prod: "json" as const, dev: "pretty" as const },
  logLevel: { prod: "info" as const, dev: "debug" as const },
  secretToken: { dev: "dev-secret" },
  serverPort: { prod: 3000, dev: 3334 },
  hostDaemonPort: { prod: 3001, dev: 3002 },
  serverUrl: { prod: "http://localhost:3000", dev: "http://localhost:3334" },
  appPort: { dev: 5173 },
  inferenceModel: "openai/gpt-4o-mini",
};
