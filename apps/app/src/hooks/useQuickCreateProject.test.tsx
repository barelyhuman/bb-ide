// @vitest-environment jsdom

import { Suspense, useEffect, type ReactNode } from "react";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { Host } from "@bb/domain";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@bb/host-daemon-contract";
import {
  createProjectRequestSchema,
  type CreateProjectRequest,
} from "@bb/server-contract";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { afterEach, describe, expect, it, vi } from "vitest";

type HostOverrides = Partial<Host>;

interface QuickCreateFetchState {
  daemonConnected: boolean;
  hostDaemonPort: number | null;
  hosts: Host[];
}

interface SuspenseWrapperProps {
  children: ReactNode;
}

type QuickCreateProjectSnapshot = ReturnType<
  typeof import("./useQuickCreateProject").useQuickCreateProject
>;

interface QuickCreateProjectCaptureProps {
  onSnapshot: (snapshot: QuickCreateProjectSnapshot) => void;
  useQuickCreateProject: typeof import("./useQuickCreateProject").useQuickCreateProject;
}

function makeHost(overrides: HostOverrides = {}): Host {
  return {
    createdAt: 1,
    id: "host-1",
    lastSeenAt: 1,
    name: "Local Host",
    status: "connected",
    type: "persistent",
    updatedAt: 1,
    ...overrides,
  };
}

function createSuspenseWrapper() {
  const { wrapper: baseWrapper } = createQueryClientTestHarness();

  return ({ children }: SuspenseWrapperProps) =>
    baseWrapper({
      children: <Suspense fallback={null}>{children}</Suspense>,
    });
}

function QuickCreateProjectCapture({
  onSnapshot,
  useQuickCreateProject,
}: QuickCreateProjectCaptureProps) {
  const snapshot = useQuickCreateProject();

  useEffect(() => {
    onSnapshot(snapshot);
  }, [onSnapshot, snapshot]);

  return null;
}

function requireQuickCreateProjectSnapshot(
  snapshot: QuickCreateProjectSnapshot | null,
): QuickCreateProjectSnapshot {
  if (!snapshot) {
    throw new Error("Expected quick-create project hook snapshot.");
  }
  return snapshot;
}

function installQuickCreateFetchRoutes(
  state: QuickCreateFetchState,
  createdProjectRequests: CreateProjectRequest[],
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
      pathname: "/api/v1/hosts",
      handler: async () => jsonResponse(state.hosts),
    },
    {
      pathname: "/status",
      port: 4123,
      handler: async () =>
        state.daemonConnected
          ? jsonResponse({
              connected: true,
              hostId: "host-1",
              protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
              serverUrl: "http://localhost:3334",
              supportsNativeFolderPicker: false,
              platform: "linux",
            })
          : new Response(null, { status: 503 }),
    },
    {
      method: "POST",
      pathname: "/api/v1/projects",
      handler: async (request) => {
        createdProjectRequests.push(
          createProjectRequestSchema.parse(await request.json()),
        );

        return jsonResponse({
          createdAt: 1,
          id: "proj-1",
          name: "demo",
          sources: [],
          updatedAt: 1,
        });
      },
    },
  ]);
}

async function importFreshUseQuickCreateProject(): Promise<
  typeof import("./useQuickCreateProject")
> {
  vi.resetModules();
  return import("./useQuickCreateProject");
}

afterEach(() => {
  cleanup();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useQuickCreateProject", () => {
  it("opens a path dialog whenever a local host is available", async () => {
    installQuickCreateFetchRoutes(
      {
        daemonConnected: true,
        hostDaemonPort: 4123,
        hosts: [makeHost()],
      },
      [],
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(true);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current)
        .projectPathDialog.target,
    ).toEqual({ kind: "create" });
  });

  it("creates a project from the submitted absolute path and closes the dialog on success", async () => {
    const createdProjectRequests: CreateProjectRequest[] = [];
    installQuickCreateFetchRoutes(
      {
        daemonConnected: true,
        hostDaemonPort: 4123,
        hosts: [makeHost()],
      },
      createdProjectRequests,
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(true);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).submitProjectPath({ kind: "create" }, "/srv/repos/demo");
    });

    await waitFor(() => {
      expect(createdProjectRequests).toHaveLength(1);
    });

    expect(createdProjectRequests[0]).toEqual({
      name: "demo",
      source: {
        hostId: "host-1",
        path: "/srv/repos/demo",
        type: "local_path",
      },
    });
    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current)
          .projectPathDialog.isOpen,
      ).toBe(false);
    });
  });

  it("does not open the create dialog when no local host is available", async () => {
    installQuickCreateFetchRoutes(
      {
        daemonConnected: false,
        hostDaemonPort: null,
        hosts: [],
      },
      [],
    );

    const { useQuickCreateProject } = await importFreshUseQuickCreateProject();
    const latestSnapshot: { current: QuickCreateProjectSnapshot | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <QuickCreateProjectCapture
          onSnapshot={(snapshot) => {
            latestSnapshot.current = snapshot;
          }}
          useQuickCreateProject={useQuickCreateProject}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(
        requireQuickCreateProjectSnapshot(latestSnapshot.current).isAvailable,
      ).toBe(false);
    });

    act(() => {
      requireQuickCreateProjectSnapshot(
        latestSnapshot.current,
      ).openCreateDialog();
    });

    expect(
      requireQuickCreateProjectSnapshot(latestSnapshot.current)
        .projectPathDialog.target,
    ).toBeNull();
  });

});
