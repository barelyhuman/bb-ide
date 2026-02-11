// Client -> Server
export interface SubscribeMessage {
  type: "subscribe";
  entity: "thread";
  id?: string;
}

export interface UnsubscribeMessage {
  type: "unsubscribe";
  entity: "thread";
  id?: string;
}

export type ClientMessage = SubscribeMessage | UnsubscribeMessage;

// Server -> Client
export interface ChangedMessage {
  type: "changed";
  entity: "thread";
  id?: string;
}

export type ServerMessage = ChangedMessage;
