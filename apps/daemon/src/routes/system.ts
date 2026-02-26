import { Hono } from "hono";
import type {
  AvailableModel,
  SystemEnvironmentInfo,
  SystemProviderInfo,
  SystemStatus,
  ThreadOrchestrator,
} from "@beanbag/agent-core";
import { pickFolderPath } from "../folder-picker.js";
import { sendRouteError } from "./error-response.js";

type PickFolderFn = () => Promise<string | null>;
type ListModelsFn = () => Promise<AvailableModel[]>;
type ProviderInfoFn = () => SystemProviderInfo;
type ProviderCatalogFn = () => SystemProviderInfo[];
type EnvironmentInfoFn = () => SystemEnvironmentInfo;
type EnvironmentCatalogFn = () => SystemEnvironmentInfo[];

export function createSystemRoutes(
  threadManager: ThreadOrchestrator,
  startTime: number,
  pickFolder: PickFolderFn = pickFolderPath,
  listModels: ListModelsFn = () => threadManager.listModels(),
  getProviderInfo: ProviderInfoFn = () => threadManager.getProviderInfo(),
  listProviders: ProviderCatalogFn = () => threadManager.listProviders(),
  getEnvironmentInfo: EnvironmentInfoFn = () => threadManager.getEnvironmentInfo(),
  listEnvironments: EnvironmentCatalogFn = () => threadManager.listEnvironments(),
) {
  return new Hono()
    .get("/status", async (c) => {
      try {
        const runningThreads = threadManager.getRunningCount();
        const totalThreads = threadManager.list().length;

        const status: SystemStatus = {
          runningThreads,
          totalThreads,
          uptime: Math.floor((Date.now() - startTime) / 1000),
        };

        return c.json(status);
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .post("/pick-folder", async (c) => {
      try {
        const path = await pickFolder();
        return c.json({ path });
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/models", async (c) => {
      try {
        const models = await listModels();
        return c.json(models);
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/provider", async (c) => {
      try {
        return c.json(getProviderInfo());
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/providers", async (c) => {
      try {
        return c.json(listProviders());
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/environment", async (c) => {
      try {
        return c.json(getEnvironmentInfo());
      } catch (err) {
        return sendRouteError(c, err);
      }
    })
    .get("/environments", async (c) => {
      try {
        return c.json(listEnvironments());
      } catch (err) {
        return sendRouteError(c, err);
      }
    });
}
