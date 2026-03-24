// Re-export all change-kind constants, types, and message interfaces from @bb/domain.
// This file previously owned these definitions; they now live in @bb/domain
// and are re-exported here so existing consumers of @bb/server-contract are unaffected.

export {
  THREAD_CHANGE_KINDS,
  PROJECT_CHANGE_KINDS,
  SYSTEM_CHANGE_KINDS,
} from "@bb/domain";
export type {
  RealtimeEntity,
  ThreadChangeKind,
  ProjectChangeKind,
  SystemChangeKind,
  SubscribeMessage,
  UnsubscribeMessage,
  ClientMessage,
  ThreadChangedMessage,
  ProjectChangedMessage,
  SystemChangedMessage,
  ChangedMessage,
  ServerMessage,
} from "@bb/domain";
