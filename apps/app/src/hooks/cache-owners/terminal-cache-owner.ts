import type { QueryClient } from "@tanstack/react-query";
import type {
  TerminalSession,
  ThreadTerminalListResponse,
} from "@bb/server-contract";
import {
  THREAD_TERMINALS_QUERY_KEY,
  threadTerminalsQueryKey,
} from "../queries/query-keys";
import type { CacheOwnerDescriptor } from "./cache-owner-types";

interface TerminalSessionCacheArgs {
  queryClient: QueryClient;
  session: TerminalSession;
}

interface CloseTerminalSessionCacheArgs extends TerminalSessionCacheArgs {
  terminalId: string;
}

export const terminalCacheOwner = {
  id: "terminal",
  ownedQueryRoots: [THREAD_TERMINALS_QUERY_KEY],
  handledRealtimeEvents: [{ entity: "thread", kind: "terminals-changed" }],
  bootstrapPolicy:
    "Owns terminal list query data and terminal mutation cache updates.",
  deletionBehavior: "Removes terminal projections when a thread is deleted.",
  reconnectBehavior: "Refreshes terminal projections after reconnect.",
} satisfies CacheOwnerDescriptor;

function upsertTerminalSession(
  current: ThreadTerminalListResponse | undefined,
  session: TerminalSession,
): ThreadTerminalListResponse {
  if (!current) {
    return { sessions: [session] };
  }

  const existingIndex = current.sessions.findIndex(
    (existingSession) => existingSession.id === session.id,
  );
  if (existingIndex === -1) {
    return { sessions: [...current.sessions, session] };
  }

  return {
    sessions: current.sessions.map((existingSession) =>
      existingSession.id === session.id ? session : existingSession,
    ),
  };
}

function removeTerminalSession(
  current: ThreadTerminalListResponse | undefined,
  terminalId: string,
): ThreadTerminalListResponse | undefined {
  if (!current) {
    return current;
  }

  const sessions = current.sessions.filter((session) => {
    return session.id !== terminalId;
  });
  if (sessions.length === current.sessions.length) {
    return current;
  }

  return { sessions };
}

export function applyThreadTerminalSessionUpsert({
  queryClient,
  session,
}: TerminalSessionCacheArgs): void {
  queryClient.setQueryData<ThreadTerminalListResponse>(
    threadTerminalsQueryKey(session.threadId),
    (current) => upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: threadTerminalsQueryKey(session.threadId),
  });
}

export function applyThreadTerminalSessionClose({
  queryClient,
  session,
  terminalId,
}: CloseTerminalSessionCacheArgs): void {
  queryClient.setQueryData<ThreadTerminalListResponse>(
    threadTerminalsQueryKey(session.threadId),
    (current) =>
      session.status === "exited"
        ? removeTerminalSession(current, terminalId)
        : upsertTerminalSession(current, session),
  );
  queryClient.invalidateQueries({
    queryKey: threadTerminalsQueryKey(session.threadId),
  });
}
