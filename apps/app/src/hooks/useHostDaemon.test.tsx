// @vitest-environment jsdom

import { Suspense, useEffect, type ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  waitFor,
} from "@testing-library/react";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import type { HostDaemonStatusSnapshot } from "@/lib/api-host-daemon";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { resetFakeReconnectingWebSockets } from "@/test/fake-reconnecting-websocket";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

interface HostDaemonFetchState {
  daemonStatus: HostDaemonStatusSnapshot | null;
  hostDaemonPort: number | null;
  pickedFolderPath: string | null;
}

interface HostDaemonSnapshot {
  hasDaemon: boolean;
  isLocalHost: (hostId: string | null | undefined) => boolean;
  localHostId: string | null;
  pickFolder: (() => Promise<string | null>) | null;
  supportsNativeFolderPicker: boolean;
  platform: "darwin" | "linux" | "wsl" | "unknown" | null;
}

interface HostDaemonModules {
  FakeReconnectingWebSocket: typeof import("@/test/fake-reconnecting-websocket").FakeReconnectingWebSocket;
  useHostDaemon: () => HostDaemonSnapshot;
  wsManager: {
    connect(): void;
    disconnect(): void;
  };
}

interface SuspenseWrapperProps {
  children: ReactNode;
}

interface HostDaemonCaptureProps {
  onSnapshot: (snapshot: HostDaemonSnapshot) => void;
  useHostDaemon: HostDaemonModules["useHostDaemon"];
}

function createSuspenseWrapper() {
  const { wrapper: baseWrapper } = createQueryClientTestHarness();

  return ({ children }: SuspenseWrapperProps) =>
    baseWrapper({
      children: <Suspense fallback={null}>{children}</Suspense>,
    });
}

function HostDaemonCapture({
  onSnapshot,
  useHostDaemon,
}: HostDaemonCaptureProps) {
  const snapshot = useHostDaemon();

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

function requireHostDaemonSnapshot(
  snapshot: HostDaemonSnapshot | null,
): HostDaemonSnapshot {
  if (!snapshot) {
    throw new Error("Expected host daemon hook snapshot.");
  }
  return snapshot;
}

function installHostDaemonFetchRoutes(
  state: HostDaemonFetchState,
  pickFolderRequests: number[],
) {
  installFetchRoutes([
    {
      pathname: "/api/v1/system/config",
      handler: async () =>
        jsonResponse({
          hostDaemonPort: state.hostDaemonPort,
          voiceTranscriptionEnabled: false,
        }),
    },
    {
      pathname: "/status",
      port: 4123,
      handler: async () =>
        state.daemonStatus
          ? jsonResponse(state.daemonStatus)
          : new Response(null, { status: 503 }),
    },
    {
      method: "POST",
      pathname: "/pick-folder",
      port: 4123,
      handler: async () => {
        pickFolderRequests.push(1);
        return jsonResponse({
          path: state.pickedFolderPath,
        });
      },
    },
  ]);
}

async function importFreshHostDaemonModules(): Promise<HostDaemonModules> {
  vi.resetModules();

  const [{ useHostDaemon }, { wsManager }, { FakeReconnectingWebSocket }] =
    await Promise.all([
      import("./useHostDaemon"),
      import("@/lib/ws"),
      import("@/test/fake-reconnecting-websocket"),
    ]);

  return {
    FakeReconnectingWebSocket,
    useHostDaemon,
    wsManager,
  };
}

afterEach(() => {
  cleanup();
  resetFakeReconnectingWebSockets();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useHostDaemon", () => {
  it("exposes local daemon state and bound daemon actions when available", async () => {
    const state: HostDaemonFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: true,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      pickedFolderPath: "/picked/path",
    };
    const pickFolderRequests: number[] = [];
    installHostDaemonFetchRoutes(state, pickFolderRequests);

    const { useHostDaemon } = await importFreshHostDaemonModules();
    const latestSnapshot: { current: HostDaemonSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <HostDaemonCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useHostDaemon={useHostDaemon}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(requireHostDaemonSnapshot(latestSnapshot.current).localHostId).toBe(
        "host-1",
      );
    });

    const snapshot = requireHostDaemonSnapshot(latestSnapshot.current);
    expect(snapshot.hasDaemon).toBe(true);
    expect(snapshot.supportsNativeFolderPicker).toBe(true);
    expect(snapshot.isLocalHost("host-1")).toBe(true);
    expect(snapshot.isLocalHost("host-2")).toBe(false);

    await act(async () => {
      await requireHostDaemonSnapshot(latestSnapshot.current).pickFolder?.();
    });

    await waitFor(() => {
      expect(pickFolderRequests).toEqual([1]);
    });
  });

  it("returns null actions when the daemon or local host id is unavailable", async () => {
    const state: HostDaemonFetchState = {
      daemonStatus: null,
      hostDaemonPort: null,
      pickedFolderPath: null,
    };
    installHostDaemonFetchRoutes(state, []);

    const { useHostDaemon } = await importFreshHostDaemonModules();
    const latestSnapshot: { current: HostDaemonSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <HostDaemonCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useHostDaemon={useHostDaemon}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireHostDaemonSnapshot(latestSnapshot.current).localHostId,
      ).toBeNull();
    });
    const snapshot = requireHostDaemonSnapshot(latestSnapshot.current);
    expect(snapshot.hasDaemon).toBe(false);
    expect(snapshot.supportsNativeFolderPicker).toBe(false);
    expect(snapshot.isLocalHost("host-1")).toBe(false);
    expect(snapshot.pickFolder).toBeNull();
  });

  it("re-probes daemon capabilities after websocket reconnects", async () => {
    const state: HostDaemonFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "linux",
      },
      hostDaemonPort: 4123,
      pickedFolderPath: null,
    };
    installHostDaemonFetchRoutes(state, []);

    const { FakeReconnectingWebSocket, useHostDaemon, wsManager } =
      await importFreshHostDaemonModules();
    const latestSnapshot: { current: HostDaemonSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <HostDaemonCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useHostDaemon={useHostDaemon}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireHostDaemonSnapshot(latestSnapshot.current)
          .supportsNativeFolderPicker,
      ).toBe(false);
    });

    wsManager.connect();
    const socket = FakeReconnectingWebSocket.latest();
    socket.open();
    socket.close();
    state.daemonStatus = {
      connected: true,
      hostId: "host-1",
      protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
      serverUrl: "http://localhost:3334",
      supportsNativeFolderPicker: true,
      platform: "linux",
    };
    socket.open();

    await waitFor(() => {
      expect(
        requireHostDaemonSnapshot(latestSnapshot.current)
          .supportsNativeFolderPicker,
      ).toBe(true);
    });

    wsManager.disconnect();
  });
});
