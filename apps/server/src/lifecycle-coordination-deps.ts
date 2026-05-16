import type { AppDeps } from "./types.js";

export type LifecycleCoordinationDeps = Pick<
  AppDeps,
  | "config"
  | "db"
  | "hostLifecycle"
  | "hub"
  | "lifecycleDedupers"
  | "logger"
  | "machineAuth"
>;

export type InteractiveLifecycleCoordinationDeps = LifecycleCoordinationDeps &
  Pick<AppDeps, "pendingInteractions">;
