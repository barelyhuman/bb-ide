export type RealtimeEntity = "thread";

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "thread-deleted",
  "events-appended",
  "status-changed",
  "title-changed",
  "work-status-changed",
  "archived-changed",
  "read-state-changed",
] as const;

export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];

// Client -> Server
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

// Server -> Client
export interface ChangedMessage {
  type: "changed";
  entity: RealtimeEntity;
  id?: string;
  changes: ThreadChangeKind[];
}

export type ServerMessage = ChangedMessage;
