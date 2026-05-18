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
  type WorkspaceOpenTarget,
} from "@bb/host-daemon-contract";
import type { HostDaemonStatusSnapshot } from "@/lib/api-host-daemon";
import { WORKSPACE_OPEN_TARGET_STORAGE_KEY } from "@/lib/workspace-open-target-preference";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { resetFakeReconnectingWebSockets } from "@/test/fake-reconnecting-websocket";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

const { toastError } = vi.hoisted(() => ({
  toastError: vi.fn(),
}));

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

vi.mock("sonner", () => ({
  toast: {
    error: toastError,
  },
}));

interface LocalOpenTargetsFetchState {
  daemonStatus: HostDaemonStatusSnapshot | null;
  hostDaemonPort: number | null;
  workspaceOpenTargets: WorkspaceOpenTarget[];
  workspaceOpenTargetsStatus: number;
}

interface LocalOpenTargetsModules {
  useHostDaemon: typeof import("./useHostDaemon").useHostDaemon;
  useLocalOpenTargets: typeof import("./useLocalOpenTargets").useLocalOpenTargets;
}

interface SuspenseWrapperProps {
  children: ReactNode;
}

interface LocalOpenTargetsSnapshot {
  hostDaemon: ReturnType<LocalOpenTargetsModules["useHostDaemon"]>;
  localOpenTargets: ReturnType<
    LocalOpenTargetsModules["useLocalOpenTargets"]
  >;
}

interface LocalOpenTargetsCaptureProps {
  modules: LocalOpenTargetsModules;
  onSnapshot: (snapshot: LocalOpenTargetsSnapshot) => void;
}

function createSuspenseWrapper() {
  const { wrapper: baseWrapper } = createQueryClientTestHarness();

  return ({ children }: SuspenseWrapperProps) =>
    baseWrapper({
      children: <Suspense fallback={null}>{children}</Suspense>,
    });
}

function LocalOpenTargetsCapture({
  modules,
  onSnapshot,
}: LocalOpenTargetsCaptureProps) {
  const hostDaemon = modules.useHostDaemon();
  const localOpenTargets = modules.useLocalOpenTargets({ enabled: true });

  useEffect(() => {
    onSnapshot({ hostDaemon, localOpenTargets });
  }, [hostDaemon, localOpenTargets, onSnapshot]);

  return null;
}

function requireLocalOpenTargetsSnapshot(
  snapshot: LocalOpenTargetsSnapshot | null,
): LocalOpenTargetsSnapshot {
  if (!snapshot) {
    throw new Error("Expected local open targets hook snapshot.");
  }
  return snapshot;
}

function installLocalOpenTargetsFetchRoutes(
  state: LocalOpenTargetsFetchState,
  openTargetRequests: Array<ReturnType<typeof openInTargetRequestSchema.parse>>,
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

async function importFreshLocalOpenTargetsModules(): Promise<LocalOpenTargetsModules> {
  vi.resetModules();

  const [{ useLocalOpenTargets }, { useHostDaemon }] = await Promise.all([
    import("./useLocalOpenTargets"),
    import("./useHostDaemon"),
  ]);

  return {
    useLocalOpenTargets,
    useHostDaemon,
  };
}

afterEach(() => {
  cleanup();
  resetFakeReconnectingWebSockets();
  toastError.mockReset();
  window.localStorage.clear();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLocalOpenTargets", () => {
  it("opens in the stored preferred target", async () => {
    window.localStorage.setItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY, "finder");
    const state: LocalOpenTargetsFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      workspaceOpenTargets: [
        { id: "vscode", kind: "editor", label: "VS Code" },
        { id: "finder", kind: "file-browser", label: "Finder" },
      ],
      workspaceOpenTargetsStatus: 200,
    };
    const openTargetRequests: Array<
      ReturnType<typeof openInTargetRequestSchema.parse>
    > = [];
    installLocalOpenTargetsFetchRoutes(state, openTargetRequests);
    const modules = await importFreshLocalOpenTargetsModules();
    const latestSnapshot: { current: LocalOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <LocalOpenTargetsCapture
          modules={modules}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireLocalOpenTargetsSnapshot(latestSnapshot.current).localOpenTargets
          .preferredTarget?.label,
      ).toBe("Finder");
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.ts",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: 27,
          path: "/tmp/workspace/file.ts",
          targetId: "finder",
        },
      ]);
    });
  });

  it("stores an explicitly selected target for future opens", async () => {
    const state: LocalOpenTargetsFetchState = {
      daemonStatus: {
        connected: true,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      workspaceOpenTargets: [
        { id: "vscode", kind: "editor", label: "VS Code" },
        { id: "finder", kind: "file-browser", label: "Finder" },
      ],
      workspaceOpenTargetsStatus: 200,
    };
    const openTargetRequests: Array<
      ReturnType<typeof openInTargetRequestSchema.parse>
    > = [];
    installLocalOpenTargetsFetchRoutes(state, openTargetRequests);
    const modules = await importFreshLocalOpenTargetsModules();
    const latestSnapshot: { current: LocalOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <LocalOpenTargetsCapture
          modules={modules}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireLocalOpenTargetsSnapshot(latestSnapshot.current).localOpenTargets
          .workspaceOpenTargets,
      ).toHaveLength(2);
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInTarget({
        lineNumber: null,
        path: "/tmp/workspace/file.ts",
        rememberTarget: true,
        targetId: "finder",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: null,
          path: "/tmp/workspace/file.ts",
          targetId: "finder",
        },
      ]);
    });
    expect(window.localStorage.getItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "finder",
    );
  });

  it("shows a localhost connectivity error when preferred opens are unavailable", async () => {
    const state: LocalOpenTargetsFetchState = {
      daemonStatus: {
        connected: false,
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
    const openTargetRequests: Array<
      ReturnType<typeof openInTargetRequestSchema.parse>
    > = [];
    installLocalOpenTargetsFetchRoutes(state, openTargetRequests);
    const modules = await importFreshLocalOpenTargetsModules();
    const latestSnapshot: { current: LocalOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <LocalOpenTargetsCapture
          modules={modules}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.ts",
      });
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Failed to open file locally", {
        description: "Localhost is disconnected.",
      });
    });
    expect(openTargetRequests).toEqual([]);
  });

  it("shows a no-targets error when localhost is connected but no open targets are available", async () => {
    const state: LocalOpenTargetsFetchState = {
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
    const openTargetRequests: Array<
      ReturnType<typeof openInTargetRequestSchema.parse>
    > = [];
    installLocalOpenTargetsFetchRoutes(state, openTargetRequests);
    const modules = await importFreshLocalOpenTargetsModules();
    const latestSnapshot: { current: LocalOpenTargetsSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <LocalOpenTargetsCapture
          modules={modules}
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireLocalOpenTargetsSnapshot(latestSnapshot.current).hostDaemon
          .hasDaemon,
      ).toBe(true);
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.ts",
      });
    });

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("Failed to open file locally", {
        description: "No local editor is available.",
      });
    });
    expect(openTargetRequests).toEqual([]);
  });
});
