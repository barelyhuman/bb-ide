// @vitest-environment jsdom

import {
  isValidElement,
  Suspense,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
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
import {
  FILE_OPEN_TARGET_STORAGE_KEY,
  WORKSPACE_OPEN_TARGET_STORAGE_KEY,
} from "@/lib/workspace-open-target-preference";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { resetFakeReconnectingWebSockets } from "@/test/fake-reconnecting-websocket";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

interface CapturedToastProps {
  description?: ReactNode;
  title: ReactNode;
  tone: string;
}

interface CapturedToastOptions {
  id: string;
}

interface SonnerCustomOptions {
  id?: string | number;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

const sonnerToastState = vi.hoisted(() => {
  const invocations: SonnerCustomToast[] = [];
  return {
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const id =
          typeof options?.id === "string" || typeof options?.id === "number"
            ? String(options.id)
            : fallbackId;
        const toast = {
          options: { id },
          renderToast,
        };
        invocations.push(toast);
        return id;
      },
    ),
    dismiss: vi.fn(),
    invocations,
  };
});

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

vi.mock("sonner", () => ({
  toast: {
    custom: sonnerToastState.custom,
    dismiss: sonnerToastState.dismiss,
  },
}));

interface LocalOpenTargetsFetchState {
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

const defaultAppTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: true,
    openFileAtLine: false,
  },
  id: "default-app",
  label: "Default App",
};

const finderTarget: WorkspaceOpenTarget = {
  capabilities: {
    openDirectory: true,
    openFile: false,
    openFileAtLine: false,
  },
  id: "finder",
  label: "Finder",
};

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

function readLatestToastProps(): CapturedToastProps {
  const invocation = sonnerToastState.invocations.at(-1);
  if (!invocation) {
    throw new Error("Expected local open target toast invocation.");
  }
  const element = invocation.renderToast(invocation.options.id);
  if (!isValidElement<CapturedToastProps>(element)) {
    throw new Error("Expected app toast content element.");
  }
  return element.props;
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
  sonnerToastState.invocations.splice(0);
  sonnerToastState.custom.mockClear();
  sonnerToastState.dismiss.mockClear();
  window.localStorage.clear();
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLocalOpenTargets", () => {
  it("opens in the stored preferred directory target when the daemon API is reachable", async () => {
    window.localStorage.setItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY, "finder");
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
      workspaceOpenTargets: [vscodeTarget, finderTarget],
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
          .preferredDirectoryTarget?.label,
      ).toBe("Finder");
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredDirectoryTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.ts",
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
  });

  it("opens files in the stored file target independently of the workspace target", async () => {
    window.localStorage.setItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY, "finder");
    window.localStorage.setItem(FILE_OPEN_TARGET_STORAGE_KEY, "vscode");
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
      workspaceOpenTargets: [finderTarget, defaultAppTarget, vscodeTarget],
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
      const localOpenTargets = requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets;
      expect(localOpenTargets.preferredDirectoryTarget?.label).toBe("Finder");
      expect(localOpenTargets.preferredFileTarget?.label).toBe("VS Code");
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredFileTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.md",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: 27,
          path: "/tmp/workspace/file.md",
          targetId: "vscode",
        },
      ]);
    });
  });

  it("opens file requests in a direct file target when the stored workspace target is Finder", async () => {
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
      workspaceOpenTargets: [defaultAppTarget, finderTarget],
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
      const localOpenTargets = requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets;
      expect(localOpenTargets.preferredDirectoryTarget?.label).toBe("Finder");
      expect(localOpenTargets.preferredFileTarget?.label).toBe("Default App");
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredFileTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.md",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: null,
          path: "/tmp/workspace/file.md",
          targetId: "default-app",
        },
      ]);
    });
  });

  it("stores an explicitly selected file-capable target for directory and file opens", async () => {
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
      workspaceOpenTargets: [vscodeTarget, finderTarget],
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
          .directoryOpenTargets,
      ).toHaveLength(2);
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInDirectoryTarget({
        lineNumber: null,
        path: "/tmp/workspace/file.ts",
        rememberTarget: true,
        targetId: "vscode",
      });
    });

    await waitFor(() => {
      expect(openTargetRequests).toEqual([
        {
          lineNumber: null,
          path: "/tmp/workspace/file.ts",
          targetId: "vscode",
        },
      ]);
    });
    expect(window.localStorage.getItem(WORKSPACE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "vscode",
    );
    expect(window.localStorage.getItem(FILE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "vscode",
    );
  });

  it("keeps the file default when the selected directory target cannot open files", async () => {
    window.localStorage.setItem(FILE_OPEN_TARGET_STORAGE_KEY, "vscode");
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
      workspaceOpenTargets: [vscodeTarget, finderTarget],
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
          .directoryOpenTargets,
      ).toHaveLength(2);
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInDirectoryTarget({
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
    expect(window.localStorage.getItem(FILE_OPEN_TARGET_STORAGE_KEY)).toBe(
      "vscode",
    );
  });

  it("shows a file target error when only Finder is available for file opens", async () => {
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
      workspaceOpenTargets: [finderTarget],
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
      const localOpenTargets = requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets;
      expect(localOpenTargets.preferredDirectoryTarget?.label).toBe("Finder");
      expect(localOpenTargets.preferredFileTarget).toBeNull();
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredFileTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.md",
      });
    });

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalled();
    });
    const toastProps = readLatestToastProps();
    expect(toastProps.tone).toBe("error");
    expect(toastProps.title).toBe("Failed to open file locally");
    expect(toastProps.description).toBe("No local app can open files.");
    expect(openTargetRequests).toEqual([]);
  });

  it("shows a local daemon unavailable error when preferred directory opens are unavailable", async () => {
    vi.useFakeTimers();
    const state: LocalOpenTargetsFetchState = {
      daemonStatus: null,
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
      await vi.advanceTimersByTimeAsync(2_000);
    });

    await act(async () => {
      await requireLocalOpenTargetsSnapshot(
        latestSnapshot.current,
      ).localOpenTargets.openPathInPreferredDirectoryTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.ts",
      });
    });

    expect(sonnerToastState.custom).toHaveBeenCalled();
    const toastProps = readLatestToastProps();
    expect(toastProps.tone).toBe("error");
    expect(toastProps.title).toBe("Failed to open file locally");
    expect(toastProps.description).toBe("Local host daemon is unavailable.");
    expect(openTargetRequests).toEqual([]);
  });

  it("shows a no-targets error when the daemon is reachable but no open targets are available", async () => {
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
      ).localOpenTargets.openPathInPreferredDirectoryTarget({
        lineNumber: 27,
        path: "/tmp/workspace/file.ts",
      });
    });

    await waitFor(() => {
      expect(sonnerToastState.custom).toHaveBeenCalled();
    });
    const toastProps = readLatestToastProps();
    expect(toastProps.tone).toBe("error");
    expect(toastProps.title).toBe("Failed to open file locally");
    expect(toastProps.description).toBe("No local app can open directories.");
    expect(openTargetRequests).toEqual([]);
  });
});
