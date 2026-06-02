import { randomUUID } from "node:crypto";
import {
  parseHostDaemonOnlineRpcResultForCommand,
  type HostDaemonOnlineRpcCommand,
  type HostDaemonOnlineRpcResponseMessage,
  type HostDaemonOnlineRpcResultForCommand,
  type HostDaemonRetryableOnlineRpcCommand,
} from "@bb/host-daemon-contract";
import { ApiError } from "../../errors.js";
import type { WorkSessionDeps } from "../../types.js";
import {
  HostOnlineRpcTimeoutError,
  HostOnlineRpcUnavailableError,
} from "../../ws/hub.js";
import { ensureHostSessionReadyForWork } from "./host-lifecycle.js";

export interface CallHostOnlineRpcArgs<
  TCommand extends HostDaemonOnlineRpcCommand,
> {
  command: TCommand;
  hostId: string;
  timeoutMs: number;
}

export interface CallHostRetryableOnlineRpcArgs<
  TCommand extends HostDaemonRetryableOnlineRpcCommand,
> {
  command: TCommand;
  hostId: string;
  timeoutMs: number;
}

export function callHostOnlineRpc<TCommand extends HostDaemonOnlineRpcCommand>(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<TCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>>;
export async function callHostOnlineRpc(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonOnlineRpcCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand> {
  return callHostOnlineRpcWithRetry(deps, args, { retryOnUnavailable: false });
}

export function callHostRetryableOnlineRpc<
  TCommand extends HostDaemonRetryableOnlineRpcCommand,
>(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<TCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand<TCommand>>;
export async function callHostRetryableOnlineRpc(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<HostDaemonRetryableOnlineRpcCommand>,
): Promise<HostDaemonOnlineRpcResultForCommand> {
  return callHostOnlineRpcWithRetry(deps, args, { retryOnUnavailable: true });
}

async function callHostOnlineRpcWithRetry(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonOnlineRpcCommand>,
  options: { retryOnUnavailable: false },
): Promise<HostDaemonOnlineRpcResultForCommand>;
async function callHostOnlineRpcWithRetry(
  deps: WorkSessionDeps,
  args: CallHostRetryableOnlineRpcArgs<HostDaemonRetryableOnlineRpcCommand>,
  options: { retryOnUnavailable: true },
): Promise<HostDaemonOnlineRpcResultForCommand>;
async function callHostOnlineRpcWithRetry(
  deps: WorkSessionDeps,
  args: CallHostOnlineRpcArgs<HostDaemonOnlineRpcCommand>,
  options: { retryOnUnavailable: boolean },
): Promise<HostDaemonOnlineRpcResultForCommand> {
  await ensureHostSessionReadyForWork(deps, { hostId: args.hostId });
  const response = await requestHostOnlineRpcResponse(deps, args).catch(
    async (error) => {
      if (
        !(error instanceof HostOnlineRpcUnavailableError) ||
        !options.retryOnUnavailable
      ) {
        throwOnlineRpcError(error);
      }
      await ensureHostSessionReadyForWork(deps, { hostId: args.hostId });
      return requestHostOnlineRpcResponse(deps, args).catch((retryError) => {
        throwOnlineRpcError(retryError);
      });
    },
  );

  if (!response.ok) {
    throw new ApiError(502, response.errorCode, response.errorMessage, false);
  }

  if (response.commandType !== args.command.type) {
    throw new ApiError(
      500,
      "command_result_type_mismatch",
      `Host RPC ${response.requestId} completed with unexpected type ${response.commandType}`,
    );
  }

  return parseHostDaemonOnlineRpcResultForCommand(args.command, response.result);
}

function requestHostOnlineRpcResponse(
  deps: Pick<WorkSessionDeps, "hub">,
  args: CallHostOnlineRpcArgs<HostDaemonOnlineRpcCommand>,
): Promise<HostDaemonOnlineRpcResponseMessage> {
  return deps.hub.requestHostOnlineRpc({
    hostId: args.hostId,
    message: {
      type: "host-rpc.request",
      requestId: randomUUID(),
      command: args.command,
    },
    timeoutMs: args.timeoutMs,
  });
}

function throwOnlineRpcError(error: unknown): never {
  if (error instanceof HostOnlineRpcTimeoutError) {
    throw new ApiError(
      504,
      "command_timeout",
      "Timed out waiting for command result",
    );
  }

  if (error instanceof HostOnlineRpcUnavailableError) {
    throw new ApiError(502, "host_unavailable", "Host is not connected", false);
  }

  throw error;
}
