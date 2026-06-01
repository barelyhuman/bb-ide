import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CloseThreadTerminalRequest,
  CreateThreadTerminalRequest,
  TerminalSession,
  ThreadTerminalListResponse,
  UpdateThreadTerminalRequest,
} from "@bb/server-contract";
import * as api from "@/lib/api";
import {
  applyThreadTerminalSessionClose,
  applyThreadTerminalSessionUpsert,
} from "../cache-owners/terminal-cache-owner";
import { threadTerminalsQueryKey } from "./query-keys";

interface QueryOptions {
  enabled?: boolean;
}

interface CreateThreadTerminalMutationRequest
  extends CreateThreadTerminalRequest {
  threadId: string;
}

interface RenameThreadTerminalMutationRequest
  extends UpdateThreadTerminalRequest {
  terminalId: string;
  threadId: string;
}

interface CloseThreadTerminalMutationRequest {
  mode: CloseThreadTerminalRequest["mode"];
  terminalId: string;
  threadId: string;
}

function requireThreadId(id: string, hookName: string): string {
  if (!id) {
    throw new Error(`${hookName}: thread id is required when query is enabled`);
  }

  return id;
}

export function useThreadTerminals(id: string, options?: QueryOptions) {
  return useQuery<ThreadTerminalListResponse>({
    queryKey: threadTerminalsQueryKey(id),
    queryFn: ({ signal }) =>
      api.listThreadTerminals(
        requireThreadId(id, "useThreadTerminals"),
        signal,
      ),
    enabled: (options?.enabled ?? true) && Boolean(id),
    refetchOnWindowFocus: false,
  });
}

export function useCreateThreadTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to start terminal.",
      lifecycleOperation: "open_terminal",
    },
    mutationFn: ({ threadId, ...request }: CreateThreadTerminalMutationRequest) =>
      api.createThreadTerminal(threadId, request),
    onSuccess: (session: TerminalSession) => {
      applyThreadTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useRenameThreadTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to rename terminal.",
    },
    mutationFn: ({
      terminalId,
      threadId,
      ...request
    }: RenameThreadTerminalMutationRequest) =>
      api.renameThreadTerminal(threadId, terminalId, request),
    onSuccess: (session: TerminalSession) => {
      applyThreadTerminalSessionUpsert({ queryClient, session });
    },
  });
}

export function useCloseThreadTerminal() {
  const queryClient = useQueryClient();

  return useMutation({
    meta: {
      errorMessage: "Failed to close terminal.",
    },
    mutationFn: ({
      mode,
      terminalId,
      threadId,
    }: CloseThreadTerminalMutationRequest) =>
      api.closeThreadTerminal(threadId, terminalId, { mode, reason: "user" }),
    onSuccess: (session: TerminalSession, variables) => {
      applyThreadTerminalSessionClose({
        queryClient,
        session,
        terminalId: variables.terminalId,
      });
    },
  });
}
