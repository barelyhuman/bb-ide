export type RealtimeEntity = "thread" | "project" | "system";

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "thread-deleted",
  "events-appended",
  "status-changed",
  "title-changed",
  "queue-changed",
  "work-status-changed",
  "archived-changed",
  "read-state-changed",
] as const;
export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];

export const PROJECT_CHANGE_KINDS = [
  "sources-changed",
  "threads-changed",
] as const;
export type ProjectChangeKind = (typeof PROJECT_CHANGE_KINDS)[number];

export const SYSTEM_CHANGE_KINDS = [
  "host-connected",
  "host-disconnected",
  "environment-created",
  "environment-deleted",
] as const;
export type SystemChangeKind = (typeof SYSTEM_CHANGE_KINDS)[number];

export interface SubscribeMessage {
  type: "subscribe";
  entity: RealtimeEntity;
  id?: string;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  entity: RealtimeEntity;
  id?: string;
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage;

export interface ThreadChangedMessage {
  type: "changed";
  entity: "thread";
  id?: string;
  changes: ThreadChangeKind[];
}

export interface ProjectChangedMessage {
  type: "changed";
  entity: "project";
  id?: string;
  changes: ProjectChangeKind[];
}

export interface SystemChangedMessage {
  type: "changed";
  entity: "system";
  changes: SystemChangeKind[];
}

export type ChangedMessage =
  | ThreadChangedMessage
  | ProjectChangedMessage
  | SystemChangedMessage;
export type ServerMessage = ChangedMessage;
