// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
  type RenderResult,
} from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import {
  providerCliInstallRequestSchema,
  type ProviderCliInstallEvent,
  type ProviderCliInstallRequest,
  type ProviderCliStatus,
  type ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localProviderCliStatusQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { ProviderCliHealthToasts } from "./ProviderCliHealthToasts";

interface CapturedToastOptions {
  duration?: number;
  id: string;
  onDismiss?: () => void;
}

interface RenderedProviderCliToast {
  options: CapturedToastOptions;
  view: RenderResult;
}

interface SonnerToastToDismiss {
  id: string | number;
}

type CapturedOnDismiss = (toast: SonnerToastToDismiss) => void;

interface SonnerCustomOptions {
  duration?: number;
  id?: string | number;
  onDismiss?: CapturedOnDismiss;
}

interface SonnerCustomToast {
  options: CapturedToastOptions;
  renderToast: (id: string | number) => ReactElement;
}

type ProviderCliInstallEventList = ProviderCliInstallEvent[];
type ReadonlyProviderCliInstallEventList = readonly ProviderCliInstallEvent[];
type ToastQueries = ReturnType<typeof within>;
type ToastTextMatcher = string | RegExp;

interface ProviderCliHealthFetchState {
  hostDaemonPort: number;
  installEvents: ProviderCliInstallEventList;
  installRequests: ProviderCliInstallRequest[];
  status: ProviderCliStatusResponse;
}

interface ProviderCliHealthRenderResult {
  queryClient: QueryClient;
  state: ProviderCliHealthFetchState;
}

const providerCliToastState = vi.hoisted(() => {
  const invocations: SonnerCustomToast[] = [];
  const activeToasts = new Map<string, SonnerCustomToast>();
  const toCapturedOptions = (
    options: SonnerCustomOptions | undefined,
    fallbackId: string,
  ): CapturedToastOptions => {
    const id =
      typeof options?.id === "string" || typeof options?.id === "number"
        ? String(options.id)
        : fallbackId;
    return {
      id,
      ...(typeof options?.duration === "number"
        ? { duration: options.duration }
        : {}),
      ...(options?.onDismiss
        ? { onDismiss: () => options.onDismiss?.({ id }) }
        : {}),
    };
  };
  const dismiss = vi.fn((toastId: string | number | undefined) => {
    if (toastId === undefined) {
      activeToasts.clear();
      return;
    }
    const id = String(toastId);
    const toast = activeToasts.get(id);
    activeToasts.delete(id);
    toast?.options.onDismiss?.();
  });
  return {
    activeToasts,
    custom: vi.fn(
      (
        renderToast: (id: string | number) => ReactElement,
        options?: SonnerCustomOptions,
      ) => {
        const fallbackId = `toast-${invocations.length + 1}`;
        const capturedOptions = toCapturedOptions(options, fallbackId);
        const toast = {
          options: capturedOptions,
          renderToast,
        };
        invocations.push(toast);
        activeToasts.set(capturedOptions.id, toast);
        return capturedOptions.id;
      },
    ),
    dismiss,
    invocations,
  };
});

vi.mock("sonner", () => ({
  toast: {
    custom: providerCliToastState.custom,
    dismiss: providerCliToastState.dismiss,
  },
}));

const HOST_DAEMON_PORT = 4123;
const CODEX_TOAST_ID = "provider-cli-health:codex";
const CODEX_RUN_TOAST_ID = "provider-cli-health-run:codex";
const CODEX_UPDATE_COMMAND = "npm install -g @openai/codex";
const CODEX_MISSING_FINGERPRINT = "codex:missing:0.133.0";
const CODEX_OUTDATED_FINGERPRINT =
  "codex:outdated:npmGlobal:0.132.0:0.133.0:/usr/local/bin/codex";
const DISMISSED_STORAGE_KEY_PREFIX = "bb:provider-cli-toast:dismissed-v2:";
const CODEX_DISMISSED_STORAGE_KEY = `${DISMISSED_STORAGE_KEY_PREFIX}${CODEX_MISSING_FINGERPRINT}`;
const CODEX_OUTDATED_DISMISSED_STORAGE_KEY = `${DISMISSED_STORAGE_KEY_PREFIX}${CODEX_OUTDATED_FINGERPRINT}`;

function codexMissingStatus(): ProviderCliStatus {
  return {
    currentVersion: null,
    displayName: "Codex",
    executableName: "codex",
    executablePath: null,
    installAction: {
      command: CODEX_UPDATE_COMMAND,
      commandKind: "exec",
      kind: "install",
      label: "Install",
    },
    installed: false,
    installSource: "notInstalled",
    latestVersion: "0.133.0",
    needsUpdate: false,
    npmGlobalPackageVersion: null,
    npmPackageName: "@openai/codex",
  };
}

function codexInstalledStatus(): ProviderCliStatus {
  return {
    currentVersion: "0.133.0",
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installAction: null,
    installed: true,
    installSource: "npmGlobal",
    latestVersion: "0.133.0",
    needsUpdate: false,
    npmGlobalPackageVersion: "0.133.0",
    npmPackageName: "@openai/codex",
  };
}

function codexOutdatedStatus(): ProviderCliStatus {
  return {
    currentVersion: "0.132.0",
    displayName: "Codex",
    executableName: "codex",
    executablePath: "/usr/local/bin/codex",
    installAction: {
      command: CODEX_UPDATE_COMMAND,
      commandKind: "exec",
      kind: "update",
      label: "Update",
    },
    installed: true,
    installSource: "npmGlobal",
    latestVersion: "0.133.0",
    needsUpdate: true,
    npmGlobalPackageVersion: "0.132.0",
    npmPackageName: "@openai/codex",
  };
}

function codexOutdatedStatusWithInstallLabel(): ProviderCliStatus {
  const status = codexOutdatedStatus();
  if (status.installAction === null) {
    throw new Error("Expected outdated Codex status to have an install action.");
  }
  return {
    ...status,
    installAction: {
      ...status.installAction,
      label: "Install",
    },
  };
}

function claudeCodeInstalledStatus(): ProviderCliStatus {
  return {
    currentVersion: "1.0.0",
    displayName: "Claude Code",
    executableName: "claude",
    executablePath: "/usr/local/bin/claude",
    installAction: null,
    installed: true,
    installSource: "npmGlobal",
    latestVersion: "1.0.0",
    needsUpdate: false,
    npmGlobalPackageVersion: "1.0.0",
    npmPackageName: "@anthropic-ai/claude-code",
  };
}

function statusResponseWithCodex(
  codex: ProviderCliStatus,
): ProviderCliStatusResponse {
  return {
    claudeCode: claudeCodeInstalledStatus(),
    codex,
  };
}

function codexInstallSuccessEvents(): ProviderCliInstallEventList {
  return [
    {
      command: CODEX_UPDATE_COMMAND,
      provider: "codex",
      type: "started",
    },
    {
      provider: "codex",
      stream: "stdout",
      text: "updated\n",
      type: "output",
    },
    {
      exitCode: 0,
      provider: "codex",
      signal: null,
      success: true,
      type: "completed",
    },
  ];
}

function codexInstallFailureEvents(): ProviderCliInstallEventList {
  return [
    {
      command: CODEX_UPDATE_COMMAND,
      provider: "codex",
      type: "started",
    },
    {
      provider: "codex",
      stream: "stderr",
      text: "permission denied\n",
      type: "output",
    },
    {
      exitCode: 1,
      provider: "codex",
      signal: null,
      success: false,
      type: "completed",
    },
  ];
}

function providerCliInstallEventResponse(
  events: ReadonlyProviderCliInstallEventList,
): Response {
  const body = events.map((event) => JSON.stringify(event)).join("\n");
  return new Response(body.length > 0 ? `${body}\n` : "", {
    headers: {
      "content-type": "application/x-ndjson",
    },
  });
}

function installProviderCliHealthFetchRoutes(
  state: ProviderCliHealthFetchState,
): void {
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
      pathname: "/provider-clis/status",
      port: state.hostDaemonPort,
      handler: async () => jsonResponse(state.status),
    },
    {
      method: "POST",
      pathname: "/provider-clis/install",
      port: state.hostDaemonPort,
      handler: async (request) => {
        const requestBody = providerCliInstallRequestSchema.parse(
          await request.json(),
        );
        state.installRequests.push(requestBody);
        return providerCliInstallEventResponse(state.installEvents);
      },
    },
  ]);
}

function renderProviderCliHealthToasts(
  initialStatus: ProviderCliStatusResponse,
): ProviderCliHealthRenderResult {
  const state: ProviderCliHealthFetchState = {
    hostDaemonPort: HOST_DAEMON_PORT,
    installEvents: codexInstallSuccessEvents(),
    installRequests: [],
    status: initialStatus,
  };
  installProviderCliHealthFetchRoutes(state);

  const { queryClient, wrapper } = createQueryClientTestHarness();
  render(<ProviderCliHealthToasts />, { wrapper });

  return { queryClient, state };
}

function resetProviderCliToastState(): void {
  providerCliToastState.activeToasts.clear();
  providerCliToastState.invocations.splice(0);
  providerCliToastState.custom.mockClear();
  providerCliToastState.dismiss.mockClear();
}

function renderProviderCliToast(
  toast: SonnerCustomToast,
): RenderedProviderCliToast {
  return {
    options: toast.options,
    view: render(toast.renderToast(toast.options.id)),
  };
}

function requireLatestCodexToast(): SonnerCustomToast {
  for (
    let index = providerCliToastState.invocations.length - 1;
    index >= 0;
    index -= 1
  ) {
    const invocation = providerCliToastState.invocations[index];
    if (invocation.options.id === CODEX_TOAST_ID) {
      return invocation;
    }
  }
  throw new Error("Expected a Codex provider CLI toast invocation.");
}

function requireLatestToast(): SonnerCustomToast {
  const invocation = providerCliToastState.invocations.at(-1);
  if (!invocation) {
    throw new Error("Expected a provider CLI toast invocation.");
  }
  return invocation;
}

function renderLatestToast(): RenderedProviderCliToast {
  return renderProviderCliToast(requireLatestToast());
}

async function waitForVisibleCodexToast(): Promise<RenderedProviderCliToast> {
  await waitFor(() => {
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(true);
  });
  return renderProviderCliToast(requireLatestCodexToast());
}

function toastQueries(toast: RenderedProviderCliToast): ToastQueries {
  return within(toast.view.container);
}

interface ClickToastButtonParams {
  name: string;
  toast: RenderedProviderCliToast;
}

function clickToastButton({ name, toast }: ClickToastButtonParams): void {
  fireEvent.click(toastQueries(toast).getByRole("button", { name }));
}

interface WaitForLatestToastTextParams {
  text: ToastTextMatcher;
}

async function waitForLatestToastText({
  text,
}: WaitForLatestToastTextParams): Promise<void> {
  await waitFor(() => {
    const toast = renderLatestToast();
    try {
      expect(toastQueries(toast).getByText(text)).toBeTruthy();
    } finally {
      toast.view.unmount();
    }
  });
}

async function refetchProviderCliStatus(
  result: ProviderCliHealthRenderResult,
): Promise<void> {
  await act(async () => {
    await result.queryClient.refetchQueries({
      queryKey: localProviderCliStatusQueryKey(result.state.hostDaemonPort),
    });
  });
}

afterEach(() => {
  cleanup();
  resetProviderCliToastState();
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe("ProviderCliHealthToasts", () => {
  it("does not persist dismissal when the toast closes without the cancel button", async () => {
    renderProviderCliHealthToasts(statusResponseWithCodex(codexMissingStatus()));

    const toast = await waitForVisibleCodexToast();
    const queries = toastQueries(toast);
    expect(toast.options.duration).toBe(Infinity);
    expect(queries.getByRole("button", { name: "Install" })).toBeTruthy();
    expect(queries.queryByRole("button", { name: "Dismiss" })).toBeNull();

    act(() => {
      providerCliToastState.dismiss(toast.options.id);
    });

    expect(window.localStorage.getItem(CODEX_DISMISSED_STORAGE_KEY)).toBeNull();
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);
  });

  it("persists dismissal when the user clicks the cancel button", async () => {
    renderProviderCliHealthToasts(
      statusResponseWithCodex(codexOutdatedStatusWithInstallLabel()),
    );

    const toast = await waitForVisibleCodexToast();
    const queries = toastQueries(toast);
    expect(queries.getByRole("button", { name: "Install" })).toBeTruthy();
    expect(queries.getByRole("button", { name: "Dismiss" })).toBeTruthy();

    act(() => {
      clickToastButton({ name: "Dismiss", toast });
    });

    expect(
      window.localStorage.getItem(CODEX_OUTDATED_DISMISSED_STORAGE_KEY),
    ).toBe("true");
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);
  });

  it("runs provider CLI updates through a loading toast", async () => {
    const result = renderProviderCliHealthToasts(
      statusResponseWithCodex(codexOutdatedStatus()),
    );

    const toast = await waitForVisibleCodexToast();

    act(() => {
      clickToastButton({ name: "Update", toast });
    });

    const loadingToast = renderLatestToast();
    expect(loadingToast.options.id).toBe(CODEX_RUN_TOAST_ID);
    expect(loadingToast.view.container.querySelector(".animate-shine")).toBe(
      null,
    );
    expect(loadingToast.view.container.textContent).toContain(
      `Running ${CODEX_UPDATE_COMMAND}`,
    );
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);

    await waitForLatestToastText({ text: "Codex is up to date" });
    const successToast = renderLatestToast();
    expect(successToast.options.id).toBe(CODEX_RUN_TOAST_ID);
    expect(
      toastQueries(successToast).getByText("Codex is up to date"),
    ).toBeTruthy();
    expect(result.state.installRequests).toEqual([
      {
        actionKind: "update",
        provider: "codex",
      },
    ]);
  });

  it("opens failed provider CLI update logs from the run toast", async () => {
    const result = renderProviderCliHealthToasts(
      statusResponseWithCodex(codexOutdatedStatus()),
    );
    result.state.installEvents = codexInstallFailureEvents();

    const toast = await waitForVisibleCodexToast();

    act(() => {
      clickToastButton({ name: "Update", toast });
    });

    await waitForLatestToastText({ text: "Codex update failed" });

    const failureToast = renderLatestToast();
    const failureQueries = toastQueries(failureToast);
    expect(failureToast.options.id).toBe(CODEX_RUN_TOAST_ID);
    expect(failureQueries.getByText("Codex update failed")).toBeTruthy();
    expect(
      failureQueries.getByRole("button", { name: "View log" }),
    ).toBeTruthy();

    act(() => {
      clickToastButton({ name: "View log", toast: failureToast });
    });

    const dialog = screen.getByRole("dialog", { name: "Codex update log" });
    const dialogQueries = within(dialog);
    expect(dialog).toBeTruthy();
    expect(dialogQueries.getByText("Command exited with code 1")).toBeTruthy();
    expect(dialogQueries.getByText(/permission denied/u)).toBeTruthy();
  });

  it("warns when provider CLI setup is already running", async () => {
    renderProviderCliHealthToasts(statusResponseWithCodex(codexMissingStatus()));

    const toast = await waitForVisibleCodexToast();

    act(() => {
      clickToastButton({ name: "Install", toast });
      clickToastButton({ name: "Install", toast });
    });

    const latestToast = renderLatestToast();
    const queries = toastQueries(latestToast);
    expect(queries.getByText("Provider CLI setup already running")).toBeTruthy();
  });

  it("clears resolved issue state so a recurring missing CLI shows again", async () => {
    const result = renderProviderCliHealthToasts(
      statusResponseWithCodex(codexMissingStatus()),
    );
    await waitForVisibleCodexToast();
    window.localStorage.setItem(CODEX_DISMISSED_STORAGE_KEY, "true");

    result.state.status = statusResponseWithCodex(codexInstalledStatus());
    await refetchProviderCliStatus(result);

    await waitFor(() => {
      expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(
        false,
      );
      expect(
        window.localStorage.getItem(CODEX_DISMISSED_STORAGE_KEY),
      ).toBeNull();
    });

    const toastInvocationCountAfterResolve =
      providerCliToastState.invocations.length;
    result.state.status = statusResponseWithCodex(codexMissingStatus());
    await refetchProviderCliStatus(result);

    await waitFor(() => {
      expect(providerCliToastState.invocations.length).toBe(
        toastInvocationCountAfterResolve + 1,
      );
      expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(true);
    });
  });
});
