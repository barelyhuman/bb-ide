// @vitest-environment jsdom

import { Suspense, useEffect, type ReactNode } from "react";
import {
  act,
  cleanup,
  render,
  waitFor,
} from "@testing-library/react";
import {
  HOST_DAEMON_PROTOCOL_VERSION,
  openInTargetRequestSchema,
  type OpenInTargetRequest,
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
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

interface WorkspaceOpenTargetFetchState {
  daemonStatus: HostDaemonStatusSnapshot | null;
  hostDaemonPort: number | null;
  workspaceOpenTargets: WorkspaceOpenTarget[];
  workspaceOpenTargetsStatus: number;
}

const vscodeTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: true,
  },
  id: "vscode",
  label: "VS Code",
};

interface WorkspaceOpenTargetsModules {
  FakeReconnectingWebSocket: typeof import("@/test/fake-reconnecting-websocket").FakeReconnectingWebSocket;
  useWorkspaceOpenTargets: typeof import("./useWorkspaceOpenTargets").useWorkspaceOpenTargets;
  wsManager: {
    connect(): void;
    disconnect(): void;
  };
}

interface SuspenseWrapperProps {
  children: ReactNode;
}

type WorkspaceOpenTargetsSnapshot = ReturnType<
  WorkspaceOpenTargetsModules["useWorkspaceOpenTargets"]
>;

interface WorkspaceOpenTargetsCaptureProps {
  enabled: boolean;
  onSnapshot: (snapshot: WorkspaceOpenTargetsSnapshot) => void;
  useWorkspaceOpenTargets: WorkspaceOpenTargetsModules["useWorkspaceOpenTargets"];
}

function createSuspenseWrapper() {
  const { wrapper: baseWrapper } = createQueryClientTestHarness();

  return ({ children }: SuspenseWrapperProps) =>
    baseWrapper({
      children: <Suspense fallback={null}>{children}</Suspense>,
    });
}

function WorkspaceOpenTargetsCapture({
  enabled,
  onSnapshot,
  useWorkspaceOpenTargets,
}: WorkspaceOpenTargetsCaptureProps) {
  const snapshot = useWorkspaceOpenTargets({ enabled });

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

function requireWorkspaceOpenTargetsSnapshot(
  snapshot: WorkspaceOpenTargetsSnapshot | null,
): WorkspaceOpenTargetsSnapshot {
  if (!snapshot) {
    throw new Error("Expected workspace open targets hook snapshot.");
  }
  return snapshot;
}

function installWorkspaceOpenTargetFetchRoutes(
  state: WorkspaceOpenTargetFetchState,
  openTargetRequests: OpenInTargetRequest[] = [],
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
      pathname: "/workspace-open-targets",
      port: 4123,
      handler: async () =>
        state.workspaceOpenTargetsStatus === 200
          ? jsonResponse({ targets: state.workspaceOpenTargets })
          : new Response(null, { status: state.workspaceOpenTargetsStatus }),
    },
    {
      method: "POST",
      pathname: "/open-in-target",
      port: 4123,
      handler: async (request) => {
        openTargetRequests.push(
          openInTargetRequestSchema.parse(await request.json()),
        );
        return jsonResponse({});
      },
    },
  ]);
}

async function importFreshWorkspaceOpenTargetsModules(): Promise<WorkspaceOpenTargetsModules> {
  vi.resetModules();

  const [
    { useWorkspaceOpenTargets },
    { wsManager },
    { FakeReconnectingWebSocket },
  ] = await Promise.all([
    import("./useWorkspaceOpenTargets"),
    import("@/lib/ws"),
    import("@/test/fake-reconnecting-websocket"),
  ]);

  return {
    FakeReconnectingWebSocket,
    useWorkspaceOpenTargets,
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

describe("useWorkspaceOpenTargets", () => {
  it("does not probe the daemon when disabled", async () => {
    installFetchRoutes([]);
    const { useWorkspaceOpenTargets } =
      await importFreshWorkspaceOpenTargetsModules();
    const latestSnapshot: { current: WorkspaceOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <WorkspaceOpenTargetsCapture
          enabled={false}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useWorkspaceOpenTargets={useWorkspaceOpenTargets}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    const snapshot = requireWorkspaceOpenTargetsSnapshot(
      latestSnapshot.current,
    );
    expect(snapshot.workspaceOpenTargets).toEqual([]);
    expect(snapshot.openWorkspace).toBeNull();
  });

  it("lists workspace open targets and opens a workspace when enabled", async () => {
    const state: WorkspaceOpenTargetFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      workspaceOpenTargets: [vscodeTarget],
      workspaceOpenTargetsStatus: 200,
    };
    const openTargetRequests: OpenInTargetRequest[] = [];
    installWorkspaceOpenTargetFetchRoutes(state, openTargetRequests);

    const { useWorkspaceOpenTargets } =
      await importFreshWorkspaceOpenTargetsModules();
    const latestSnapshot: { current: WorkspaceOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <WorkspaceOpenTargetsCapture
          enabled={true}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useWorkspaceOpenTargets={useWorkspaceOpenTargets}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireWorkspaceOpenTargetsSnapshot(latestSnapshot.current)
          .workspaceOpenTargets,
      ).toHaveLength(1);
    });

    await act(async () => {
      await requireWorkspaceOpenTargetsSnapshot(
        latestSnapshot.current,
      ).openWorkspace?.({
        lineNumber: null,
        path: "/tmp/workspace",
        targetId: "vscode",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: null,
          path: "/tmp/workspace",
          targetId: "vscode",
        },
      ]);
    });
  });

  it("lists and opens targets when the daemon API is reachable before its server session opens", async () => {
    const state: WorkspaceOpenTargetFetchState = {
      daemonStatus: {
        connected: false,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      workspaceOpenTargets: [vscodeTarget],
      workspaceOpenTargetsStatus: 200,
    };
    const openTargetRequests: OpenInTargetRequest[] = [];
    installWorkspaceOpenTargetFetchRoutes(state, openTargetRequests);

    const { useWorkspaceOpenTargets } =
      await importFreshWorkspaceOpenTargetsModules();
    const latestSnapshot: { current: WorkspaceOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <WorkspaceOpenTargetsCapture
          enabled={true}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useWorkspaceOpenTargets={useWorkspaceOpenTargets}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireWorkspaceOpenTargetsSnapshot(latestSnapshot.current)
          .workspaceOpenTargets,
      ).toEqual([vscodeTarget]);
    });

    await act(async () => {
      await requireWorkspaceOpenTargetsSnapshot(
        latestSnapshot.current,
      ).openWorkspace?.({
        lineNumber: 17,
        path: "/tmp/workspace/file.ts",
        targetId: "vscode",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: 17,
          path: "/tmp/workspace/file.ts",
          targetId: "vscode",
        },
      ]);
    });
  });

  it("treats missing workspace open target routes as unsupported", async () => {
    const state: WorkspaceOpenTargetFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "linux",
      },
      hostDaemonPort: 4123,
      workspaceOpenTargets: [],
      workspaceOpenTargetsStatus: 404,
    };
    installWorkspaceOpenTargetFetchRoutes(state);

    const { useWorkspaceOpenTargets } =
      await importFreshWorkspaceOpenTargetsModules();
    const latestSnapshot: { current: WorkspaceOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <WorkspaceOpenTargetsCapture
          enabled={true}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useWorkspaceOpenTargets={useWorkspaceOpenTargets}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireWorkspaceOpenTargetsSnapshot(latestSnapshot.current)
          .workspaceOpenTargets,
      ).toEqual([]);
    });

    expect(
      requireWorkspaceOpenTargetsSnapshot(latestSnapshot.current).openWorkspace,
    ).toBeNull();
  });

  it("re-probes targets after websocket reconnects", async () => {
    const state: WorkspaceOpenTargetFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      workspaceOpenTargets: [],
      workspaceOpenTargetsStatus: 200,
    };
    installWorkspaceOpenTargetFetchRoutes(state);

    const { FakeReconnectingWebSocket, useWorkspaceOpenTargets, wsManager } =
      await importFreshWorkspaceOpenTargetsModules();
    const latestSnapshot: { current: WorkspaceOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <WorkspaceOpenTargetsCapture
          enabled={true}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useWorkspaceOpenTargets={useWorkspaceOpenTargets}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireWorkspaceOpenTargetsSnapshot(latestSnapshot.current)
          .workspaceOpenTargets,
      ).toEqual([]);
    });

    wsManager.connect();
    const socket = FakeReconnectingWebSocket.latest();
    socket.open();
    socket.close();
    state.workspaceOpenTargets = [vscodeTarget];
    socket.open();

    await waitFor(() => {
      expect(
        requireWorkspaceOpenTargetsSnapshot(latestSnapshot.current)
          .workspaceOpenTargets,
      ).toHaveLength(1);
    });

    wsManager.disconnect();
  });
});
