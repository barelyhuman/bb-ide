import {
  hostDaemonOnlineRpcResponseMessageSchema,
  hostDaemonServerWsMessageSchema,
  type HostDaemonOnlineRpcRequestMessage,
  type HostDaemonOnlineRpcResult,
} from "@bb/host-daemon-contract";
import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/errors.js";
import {
  callHostOnlineRpc,
  callHostRetryableOnlineRpc,
} from "../../src/services/hosts/online-rpc.js";
import type { NotificationHub } from "../../src/ws/hub.js";
import { seedHostSession } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

interface TestHostRpcSocket {
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

interface DropThenReplaceSocketArgs {
  hostId: string;
  hub: NotificationHub;
  requests: HostDaemonOnlineRpcRequestMessage[];
  sessionId: string;
  successResult: HostDaemonOnlineRpcResult;
}

function parseHostRpcRequest(data: string): HostDaemonOnlineRpcRequestMessage {
  const message = hostDaemonServerWsMessageSchema.parse(JSON.parse(data));
  if (message.type !== "host-rpc.request") {
    throw new Error(`Expected host-rpc.request, got ${message.type}`);
  }
  return message;
}

function registerDropThenReplaceSocket(args: DropThenReplaceSocketArgs): void {
  const retrySocket: TestHostRpcSocket = {
    close() {},
    send(data) {
      const request = parseHostRpcRequest(data);
      args.requests.push(request);
      args.hub.recordHostOnlineRpcResponse({
        sessionId: args.sessionId,
        message: hostDaemonOnlineRpcResponseMessageSchema.parse({
          type: "host-rpc.response",
          requestId: request.requestId,
          commandType: request.command.type,
          ok: true,
          result: args.successResult,
        }),
      });
    },
  };
  const droppedSocket: TestHostRpcSocket = {
    close() {},
    send(data) {
      args.requests.push(parseHostRpcRequest(data));
      args.hub.unregisterDaemon(args.sessionId);
      args.hub.registerDaemon(args.sessionId, args.hostId, retrySocket);
    },
  };
  args.hub.unregisterDaemon(args.sessionId);
  args.hub.registerDaemon(args.sessionId, args.hostId, droppedSocket);
}

describe("host online RPC retry semantics", () => {
  it("retries read-only online RPCs when the current websocket session disappears", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-read-retry",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      registerDropThenReplaceSocket({
        hostId: host.id,
        hub: harness.hub,
        requests,
        sessionId: session.id,
        successResult: { providers: [] },
      });

      await expect(
        callHostRetryableOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: { type: "provider.list" },
        }),
      ).resolves.toEqual({ providers: [] });
      expect(requests.map((request) => request.command.type)).toEqual([
        "provider.list",
        "provider.list",
      ]);
    });
  });

  it("does not retry development replay mutations after websocket unavailability", async () => {
    await withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host-online-rpc-replay-no-retry",
      });
      const requests: HostDaemonOnlineRpcRequestMessage[] = [];
      registerDropThenReplaceSocket({
        hostId: host.id,
        hub: harness.hub,
        requests,
        sessionId: session.id,
        successResult: {},
      });

      try {
        await callHostOnlineRpc(harness.deps, {
          hostId: host.id,
          timeoutMs: 1_000,
          command: {
            type: "development.replay",
            operation: "capture-delete",
            captureId: "rcap_abc123",
          },
        });
        throw new Error("Expected development replay RPC to fail");
      } catch (error) {
        if (!(error instanceof ApiError)) {
          throw error;
        }
        expect(error.status).toBe(502);
        expect(error.body.code).toBe("host_unavailable");
      }
      expect(requests.map((request) => request.command.type)).toEqual([
        "development.replay",
      ]);
    });
  });
});
