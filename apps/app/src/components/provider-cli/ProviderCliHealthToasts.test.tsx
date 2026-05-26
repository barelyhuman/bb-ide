// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { QueryClient } from "@tanstack/react-query";
import type {
  ProviderCliStatus,
  ProviderCliStatusResponse,
} from "@bb/host-daemon-contract";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localProviderCliStatusQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { installFetchRoutes, jsonResponse } from "@/test/http-test-utils";
import { ProviderCliHealthToasts } from "./ProviderCliHealthToasts";

interface ToastButton {
  label: ReactNode;
  onClick: () => void;
}

interface CapturedToastProps {
  action?: ToastButton;
  cancel?: ToastButton;
  description?: ReactNode;
  title: ReactNode;
  tone: string;
}

interface CapturedToastOptions {
  duration?: number;
  id: string;
  onDismiss?: () => void;
}

interface ProviderCliToastInvocation {
  options: CapturedToastOptions;
  props: CapturedToastProps;
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

interface ProviderCliHealthFetchState {
  hostDaemonPort: number;
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
      command: "npm install -g @openai/codex",
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
      command: "npm install -g @openai/codex",
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
  ]);
}

function renderProviderCliHealthToasts(
  initialStatus: ProviderCliStatusResponse,
): ProviderCliHealthRenderResult {
  const state: ProviderCliHealthFetchState = {
    hostDaemonPort: HOST_DAEMON_PORT,
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

function readProviderCliToast(
  toast: SonnerCustomToast,
): ProviderCliToastInvocation {
  const element = toast.renderToast(toast.options.id);
  if (!isValidElement<CapturedToastProps>(element)) {
    throw new Error("Expected app toast content element.");
  }
  return {
    options: toast.options,
    props: element.props,
  };
}

function requireLatestCodexToastInvocation(): ProviderCliToastInvocation {
  for (
    let index = providerCliToastState.invocations.length - 1;
    index >= 0;
    index -= 1
  ) {
    const invocation = providerCliToastState.invocations[index];
    if (invocation.options.id === CODEX_TOAST_ID) {
      return readProviderCliToast(invocation);
    }
  }
  throw new Error("Expected a Codex provider CLI toast invocation.");
}

function requireLatestToastInvocation(): ProviderCliToastInvocation {
  const invocation = providerCliToastState.invocations.at(-1);
  if (!invocation) {
    throw new Error("Expected a provider CLI toast invocation.");
  }
  return readProviderCliToast(invocation);
}

async function waitForVisibleCodexToast(): Promise<ProviderCliToastInvocation> {
  await waitFor(() => {
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(true);
  });
  return requireLatestCodexToastInvocation();
}

function clickToastCancel(invocation: ProviderCliToastInvocation): void {
  const cancel = invocation.props.cancel;
  if (!cancel) {
    throw new Error("Expected provider CLI toast to have a cancel action.");
  }
  cancel.onClick();
}

function requireToastAction(invocation: ProviderCliToastInvocation): ToastButton {
  const action = invocation.props.action;
  if (!action) {
    throw new Error("Expected provider CLI toast to have a primary action.");
  }
  return action;
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

    const invocation = await waitForVisibleCodexToast();
    expect(invocation.props.title).toBe("Codex CLI not installed");
    expect(invocation.props.description).toBe(
      "Install Codex so bb can start Codex sessions.",
    );
    expect(invocation.options.duration).toBe(Infinity);
    expect(requireToastAction(invocation).label).toBe("Install");
    expect(invocation.props.cancel).toBeUndefined();

    act(() => {
      providerCliToastState.dismiss(invocation.options.id);
    });

    expect(window.localStorage.getItem(CODEX_DISMISSED_STORAGE_KEY)).toBeNull();
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);
  });

  it("persists dismissal when the user clicks the cancel button", async () => {
    renderProviderCliHealthToasts(
      statusResponseWithCodex(codexOutdatedStatus()),
    );

    const invocation = await waitForVisibleCodexToast();
    expect(invocation.props.title).toBe("Codex update available");
    expect(requireToastAction(invocation).label).toBe("Update");
    expect(invocation.props.cancel?.label).toBe("Dismiss");

    act(() => {
      clickToastCancel(invocation);
    });

    expect(
      window.localStorage.getItem(CODEX_OUTDATED_DISMISSED_STORAGE_KEY),
    ).toBe("true");
    expect(providerCliToastState.activeToasts.has(CODEX_TOAST_ID)).toBe(false);
  });

  it("warns when provider CLI setup is already running", async () => {
    renderProviderCliHealthToasts(statusResponseWithCodex(codexMissingStatus()));

    const invocation = await waitForVisibleCodexToast();
    const action = requireToastAction(invocation);

    act(() => {
      action.onClick();
      action.onClick();
    });

    await waitFor(() => {
      const latestToast = requireLatestToastInvocation();
      expect(latestToast.props.title).toBe("Provider CLI setup already running");
      expect(latestToast.props.description).toBe(
        "Wait for the current install or update to finish.",
      );
      expect(latestToast.props.tone).toBe("warning");
    });
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
