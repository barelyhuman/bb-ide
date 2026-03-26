import {
  createProject,
  createProjectSource,
  createThread,
  createEnvironment,
  upsertHost,
  openSession,
  noopNotifier,
} from "@bb/db";
import type { DbConnection } from "@bb/db";
import type { NotificationHub } from "../../src/ws/hub.js";

export function seedHost(db: DbConnection, hub: NotificationHub, id?: string) {
  return upsertHost(db, hub, {
    id: id ?? `host_${Date.now()}`,
    name: "Test Host",
    type: "persistent",
  });
}

export function seedSession(db: DbConnection, hub: NotificationHub, hostId: string) {
  return openSession(db, hub, {
    hostId,
    instanceId: `inst_${Date.now()}`,
    hostName: "Test Host",
    hostType: "persistent",
    protocolVersion: 2,
    heartbeatIntervalMs: 30000,
    leaseTimeoutMs: 60000,
  });
}

export function seedProject(db: DbConnection, hub: NotificationHub) {
  return createProject(db, hub, { name: "Test Project" });
}

export function seedProjectSource(
  db: DbConnection,
  hub: NotificationHub,
  projectId: string,
  hostId: string,
) {
  return createProjectSource(db, hub, {
    projectId,
    type: "local_path",
    hostId,
    path: "/test/project",
  });
}

export function seedEnvironment(
  db: DbConnection,
  hub: NotificationHub,
  projectId: string,
  hostId: string,
) {
  return createEnvironment(db, hub, {
    projectId,
    hostId,
    path: "/test/workspace",
    status: "ready",
  });
}

export function seedThread(
  db: DbConnection,
  hub: NotificationHub,
  projectId: string,
  environmentId?: string,
) {
  return createThread(db, hub, {
    projectId,
    providerId: "default",
    type: "standard",
    environmentId: environmentId ?? null,
    status: "idle",
  });
}
