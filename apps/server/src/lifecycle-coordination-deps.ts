import type { AppDeps } from "./types.js";

export type LifecycleCoordinationDeps = Pick<
  AppDeps,
  | "cloudAuth"
  | "config"
  | "db"
  | "hostLifecycle"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
  | "sandboxEnv"
  | "sandboxRegistry"
>;

export type InteractiveLifecycleCoordinationDeps =
  LifecycleCoordinationDeps & Pick<AppDeps, "pendingInteractions">;
