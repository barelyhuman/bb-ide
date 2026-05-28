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
  pathsExistRequestSchema,
  type PathsExistRequest,
} from "@bb/host-daemon-contract";
import type { HostDaemonStatusSnapshot } from "@/lib/api-host-daemon";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { resetFakeReconnectingWebSockets } from "@/test/fake-reconnecting-websocket";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LocalPathExistence } from "./host-path-queries";

vi.mock("partysocket/ws", async () => {
  const { FakeReconnectingWebSocket: FakeSocket } =
    await import("@/test/fake-reconnecting-websocket");
  return {
    default: FakeSocket,
  };
});

interface HostPathFetchState {
  daemonStatus: HostDaemonStatusSnapshot | null;
  hostDaemonPort: number | null;
  pathExistence: LocalPathExistence;
}

interface HostPathQueryModules {
  useLocalPathExistence: typeof import("./host-path-queries").useLocalPathExistence;
}

interface SuspenseWrapperProps {
  children: ReactNode;
}

interface LocalPathExistenceCaptureProps {
  onExistence: (existence: LocalPathExistence) => void;
  paths: readonly string[];
  useLocalPathExistence: HostPathQueryModules["useLocalPathExistence"];
}

function createSuspenseWrapper() {
  const { wrapper: baseWrapper } = createQueryClientTestHarness();

  return ({ children }: SuspenseWrapperProps) =>
    baseWrapper({
      children: <Suspense fallback={null}>{children}</Suspense>,
    });
}

function LocalPathExistenceCapture({
  onExistence,
  paths,
  useLocalPathExistence,
}: LocalPathExistenceCaptureProps) {
  const existence = useLocalPathExistence(paths);

  useEffect(() => {
    onExistence(existence);
  }, [existence, onExistence]);

  return null;
}

function installHostPathFetchRoutes(
  state: HostPathFetchState,
  pathExistenceRequests: PathsExistRequest[],
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
      pathname: "/paths/exist",
      port: 4123,
      handler: async (request) => {
        const payload = pathsExistRequestSchema.parse(await request.json());
        pathExistenceRequests.push(payload);
        return jsonResponse({ existence: state.pathExistence });
      },
    },
  ]);
}

async function importFreshHostPathQueryModules(): Promise<HostPathQueryModules> {
  vi.resetModules();

  const { useLocalPathExistence } = await import("./host-path-queries");
  return { useLocalPathExistence };
}

afterEach(() => {
  cleanup();
  resetFakeReconnectingWebSockets();
  vi.useRealTimers();
  vi.resetModules();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("useLocalPathExistence", () => {
  it("checks paths when the daemon API is reachable before its server session opens", async () => {
    const state: HostPathFetchState = {
      daemonStatus: {
        connected: false,
        hostId: "host-1",
        protocolVersion: HOST_DAEMON_PROTOCOL_VERSION,
        serverUrl: "http://localhost:3334",
        supportsNativeFolderPicker: false,
        platform: "darwin",
      },
      hostDaemonPort: 4123,
      pathExistence: {
        "/missing": false,
        "/present": true,
      },
    };
    const pathExistenceRequests: PathsExistRequest[] = [];
    installHostPathFetchRoutes(state, pathExistenceRequests);

    const { useLocalPathExistence } = await importFreshHostPathQueryModules();
    const latestExistence: { current: LocalPathExistence | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <LocalPathExistenceCapture
          onExistence={(existence) => {
            latestExistence.current = existence;
          }}
          paths={["/present", "/missing", "/present"]}
          useLocalPathExistence={useLocalPathExistence}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });

    await waitFor(() => {
      expect(latestExistence.current).toEqual({
        "/missing": false,
        "/present": true,
      });
    });
    expect(pathExistenceRequests).toEqual([
      {
        paths: ["/missing", "/present"],
      },
    ]);
  });

  it("does not check paths when the daemon API is unavailable", async () => {
    vi.useFakeTimers();
    const state: HostPathFetchState = {
      daemonStatus: null,
      hostDaemonPort: 4123,
      pathExistence: {},
    };
    const pathExistenceRequests: PathsExistRequest[] = [];
    installHostPathFetchRoutes(state, pathExistenceRequests);

    const { useLocalPathExistence } = await importFreshHostPathQueryModules();
    const latestExistence: { current: LocalPathExistence | null } = {
      current: null,
    };
    await act(async () => {
      render(
        <LocalPathExistenceCapture
          onExistence={(existence) => {
            latestExistence.current = existence;
          }}
          paths={["/present"]}
          useLocalPathExistence={useLocalPathExistence}
        />,
        { wrapper: createSuspenseWrapper() },
      );
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });

    expect(latestExistence.current).toEqual({});
    expect(pathExistenceRequests).toEqual([]);
  });
});
