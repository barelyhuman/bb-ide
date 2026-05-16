/**
 * Plain default values for all BB configuration.
 *
 * Zero runtime dependencies — safe to import from config consumers and
 * tooling entrypoints that only need the raw default values.
 *
 * @bb/config uses these as its envsafe default/devDefault values.
 */
export const DEFAULTS = {
  dataDir: { prod: ".bb", dev: ".bb-dev" },
  logLevel: { prod: "info", dev: "debug" },
  secretToken: { dev: "dev-secret" },
  serverPort: { prod: 38886, dev: 3334 },
  hostDaemonPort: { prod: 38887, dev: 3002 },
  appPort: { dev: 5173 },
  devEnvPort: 9112,
  serverUrl: { prod: "http://localhost:38886", dev: "http://localhost:3334" },
  inferenceModel: "openai/gpt-4o-mini",
} as const;
