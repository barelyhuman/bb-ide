// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type {
  CloseThreadTerminalRequest,
  CreateThreadTerminalRequest,
  TerminalSession,
  ThreadTerminalListResponse,
  UpdateThreadTerminalRequest,
} from "@bb/server-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMPTY_FIXED_PANEL_TABS_STATE,
  getFixedPanelTabsStateStorageKey,
  parseFixedPanelTabsState,
  type FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import { useSetThreadTerminalPanelOpen } from "@/lib/thread-terminal-panel";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadTerminalPanel } from "./ThreadTerminalPanel";

const apiMocks = vi.hoisted(() => ({
  closeThreadTerminal: vi.fn(),
  createThreadTerminal: vi.fn(),
  listThreadTerminals: vi.fn(),
  renameThreadTerminal: vi.fn(),
}));

vi.mock("@/lib/api", () => apiMocks);

interface MockThreadTerminalViewProps {
  onTitleChange?: (title: string) => void;
  onUserInput?: () => void;
  session: TerminalSession;
}

vi.mock("./ThreadTerminalView", () => ({
  ThreadTerminalView({
    onTitleChange,
    onUserInput,
    session,
  }: MockThreadTerminalViewProps) {
    return (
      <>
        <button type="button" onClick={onUserInput}>
          Input {session.id}
        </button>
        <button type="button" onClick={() => onTitleChange?.("Edited title")}>
          Title {session.id}
        </button>
      </>
    );
  },
}));

const THREAD_ID = "thr_test";

type TerminalSessionOverrides = Partial<TerminalSession>;

interface TestTerminalPanelHarnessProps {
  canCreateTerminal?: boolean;
}

interface RenderPanelArgs {
  canCreateTerminal?: boolean;
}

let serverSessions: TerminalSession[] = [];

function makeTerminalSession(
  overrides: TerminalSessionOverrides = {},
): TerminalSession {
  return {
    id: "term_1",
    threadId: THREAD_ID,
    environmentId: "env_test",
    hostId: "host_test",
    title: "Terminal 1",
    initialCwd: "/tmp/workspace",
    currentCwd: null,
    cols: 100,
    rows: 30,
    status: "running",
    exitCode: null,
    closeReason: null,
    createdAt: 1,
    lastUserInputAt: null,
    updatedAt: 1,
    ...overrides,
  };
}

function terminalTabId(terminalId: string): string {
  return `terminal:${encodeURIComponent(terminalId)}`;
}

function readFixedPanelTabsState(): FixedPanelTabsState {
  return parseFixedPanelTabsState({
    initialValue: EMPTY_FIXED_PANEL_TABS_STATE,
    now: Date.now(),
    storedValue: window.localStorage.getItem(
      getFixedPanelTabsStateStorageKey({ threadId: THREAD_ID }),
    ),
  });
}

async function listTerminals(): Promise<ThreadTerminalListResponse> {
  return { sessions: [...serverSessions] };
}

async function createTerminal(
  threadId: string,
  request: CreateThreadTerminalRequest,
): Promise<TerminalSession> {
  const terminalNumber = serverSessions.length + 1;
  const session = makeTerminalSession({
    id: `term_${terminalNumber}`,
    threadId,
    title: `Terminal ${terminalNumber}`,
    cols: request.cols,
    rows: request.rows,
    createdAt: terminalNumber,
    updatedAt: terminalNumber,
  });
  serverSessions = [...serverSessions, session];
  return session;
}

async function closeTerminal(
  threadId: string,
  terminalId: string,
  request: CloseThreadTerminalRequest,
): Promise<TerminalSession> {
  const current = serverSessions.find((session) => {
    return session.threadId === threadId && session.id === terminalId;
  });
  if (!current) {
    throw new Error(`Missing terminal ${terminalId}`);
  }

  const closed: TerminalSession = {
    ...current,
    closeReason: request.reason,
    status: "exited",
    updatedAt: current.updatedAt + 1,
  };
  if (request.mode === "if-clean" && current.lastUserInputAt !== null) {
    return current;
  }
  serverSessions = serverSessions.map((session) => {
    return session.id === terminalId ? closed : session;
  });
  return closed;
}

async function renameTerminal(
  threadId: string,
  terminalId: string,
  request: UpdateThreadTerminalRequest,
): Promise<TerminalSession> {
  const current = serverSessions.find((session) => {
    return session.threadId === threadId && session.id === terminalId;
  });
  if (!current) {
    throw new Error(`Missing terminal ${terminalId}`);
  }

  const renamed: TerminalSession = {
    ...current,
    title: request.title,
    updatedAt: current.updatedAt + 1,
  };
  serverSessions = serverSessions.map((session) => {
    return session.id === terminalId ? renamed : session;
  });
  return renamed;
}

function TestTerminalPanelHarness({
  canCreateTerminal = true,
}: TestTerminalPanelHarnessProps) {
  const setPanelOpen = useSetThreadTerminalPanelOpen(THREAD_ID);
  return (
    <>
      <button type="button" onClick={() => setPanelOpen(true)}>
        Show panel
      </button>
      <button type="button" onClick={() => setPanelOpen(false)}>
        Hide panel
      </button>
      <ThreadTerminalPanel
        canCreateTerminal={canCreateTerminal}
        threadId={THREAD_ID}
      />
    </>
  );
}

function renderPanel(args: RenderPanelArgs = {}) {
  const harness = createQueryClientTestHarness();
  return render(
    <TestTerminalPanelHarness
      canCreateTerminal={args.canCreateTerminal ?? true}
    />,
    { wrapper: harness.wrapper },
  );
}

beforeEach(() => {
  serverSessions = [];
  window.localStorage.clear();
  apiMocks.listThreadTerminals.mockImplementation(listTerminals);
  apiMocks.createThreadTerminal.mockImplementation(createTerminal);
  apiMocks.closeThreadTerminal.mockImplementation(closeTerminal);
  apiMocks.renameThreadTerminal.mockImplementation(renameTerminal);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("ThreadTerminalPanel", () => {
  it("starts a terminal when the open panel has no visible sessions", async () => {
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));

    await waitFor(() => {
      expect(apiMocks.createThreadTerminal).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText("Start terminal")).toBeNull();
    expect(await screen.findByText("Terminal 1")).toBeTruthy();
  });

  it("closes an unused panel-created terminal when the panel is hidden", async () => {
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));
    expect(await screen.findByText("Terminal 1")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide panel"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "if-clean",
          reason: "user",
        },
      );
    });
  });

  it("removes the fixed bottom tab when a clean terminal auto-closes", async () => {
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));
    expect(await screen.findByText("Terminal 1")).toBeTruthy();
    await waitFor(() => {
      expect(readFixedPanelTabsState().bottom.activeTabId).toBe(
        terminalTabId("term_1"),
      );
    });

    fireEvent.click(screen.getByText("Hide panel"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "if-clean",
          reason: "user",
        },
      );
    });
    await waitFor(() => {
      expect(readFixedPanelTabsState().bottom.tabs).toEqual([]);
    });
    expect(readFixedPanelTabsState().bottom.activeTabId).toBeNull();
  });

  it("keeps a panel-created terminal after user input", async () => {
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));
    fireEvent.click(await screen.findByText("Input term_1"));
    fireEvent.click(screen.getByText("Hide panel"));

    expect(apiMocks.closeThreadTerminal).not.toHaveBeenCalled();
  });

  it("closes a clean terminal when the panel is hidden after remount", async () => {
    const mounted = renderPanel();

    fireEvent.click(screen.getByText("Show panel"));
    expect(await screen.findByText("Terminal 1")).toBeTruthy();

    mounted.unmount();
    renderPanel();
    expect(await screen.findByText("Terminal 1")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide panel"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "if-clean",
          reason: "user",
        },
      );
    });
  });

  it("allows closing the last tab without starting a replacement", async () => {
    serverSessions = [makeTerminalSession()];
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));
    expect(await screen.findByText("Terminal 1")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Close Terminal 1"));

    await waitFor(() => {
      expect(apiMocks.closeThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          mode: "force",
          reason: "user",
        },
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Terminal 1")).toBeNull();
    });
    expect(apiMocks.createThreadTerminal).not.toHaveBeenCalled();
    expect(screen.getAllByText("No terminals")).toHaveLength(1);
  });

  it("explains disconnected terminals and starts a replacement", async () => {
    serverSessions = [
      makeTerminalSession({
        status: "disconnected",
      }),
    ];
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));

    expect(await screen.findByText("Terminal disconnected")).toBeTruthy();
    expect(screen.queryByText("This session can't reconnect.")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Start new terminal" }),
    );

    await waitFor(() => {
      expect(apiMocks.createThreadTerminal).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Terminal 2")).toBeTruthy();
  });

  it("renames the active tab from a terminal title escape", async () => {
    serverSessions = [makeTerminalSession()];
    renderPanel();

    fireEvent.click(screen.getByText("Show panel"));
    expect(await screen.findByText("Terminal 1")).toBeTruthy();

    fireEvent.click(screen.getByText("Title term_1"));

    await waitFor(() => {
      expect(apiMocks.renameThreadTerminal).toHaveBeenCalledWith(
        THREAD_ID,
        "term_1",
        {
          title: "Edited title",
        },
      );
    });
    expect(await screen.findByText("Edited title")).toBeTruthy();
  });
});
