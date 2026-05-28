// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import type { Thread } from "@bb/domain";
import type { TimelineTurnRow } from "@bb/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadSecondaryPanel as ThreadSecondaryPanelTab } from "@/lib/thread-secondary-panel";
import { ThreadDetailSecondaryContent } from "./ThreadDetailSecondaryContent";

interface MockPanelGroupProps {
  children: ReactNode;
}

type MockPanelResizeHandler = (size: number) => void;
type MockPanelDraggingHandler = (isDragging: boolean) => void;
type TerminalPanelResizeHandler = (sizePercent: number) => void;

interface MockPanelProps {
  children: ReactNode;
  id?: string;
  onResize?: MockPanelResizeHandler;
}

interface MockPanelResizeHandleProps {
  children?: ReactNode;
  disabled?: boolean;
  onDragging?: MockPanelDraggingHandler;
}

interface MockThreadMetadataCardProps {
  children: ReactNode;
}

interface MockThreadTimelinePaneProps {
  footer: ReactNode;
  header: ReactNode;
}

vi.mock("react-resizable-panels", () => ({
  PanelGroup({ children }: MockPanelGroupProps) {
    return <div>{children}</div>;
  },
  Panel({ children, id, onResize }: MockPanelProps) {
    return (
      <section aria-label={id}>
        {onResize ? (
          <button
            type="button"
            onClick={() => onResize(45)}
            aria-label={`Resize ${id} to 45`}
          />
        ) : null}
        {children}
      </section>
    );
  },
  PanelResizeHandle({
    children,
    disabled,
    onDragging,
  }: MockPanelResizeHandleProps) {
    return (
      <div aria-disabled={disabled}>
        <button
          type="button"
          onClick={() => onDragging?.(true)}
          aria-label="Start terminal panel drag"
        />
        <button
          type="button"
          onClick={() => onDragging?.(false)}
          aria-label="End terminal panel drag"
        />
        {children}
      </div>
    );
  },
}));

vi.mock("@/components/ui/hooks/use-compact-viewport.js", () => ({
  useIsCompactViewport: () => false,
}));

vi.mock("@/components/secondary-panel/ThreadSecondaryPanel", () => ({
  ThreadSecondaryPanel() {
    return <aside>Secondary panel</aside>;
  },
}));

vi.mock("@/components/secondary-panel/ThreadMetadataContent", () => ({
  ThreadMetadataCard({ children }: MockThreadMetadataCardProps) {
    return <div>{children}</div>;
  },
  ThreadMetadataContent() {
    return <div>Thread metadata</div>;
  },
  hasAnyThreadMetadata: () => false,
}));

vi.mock("./ThreadTimelinePane", () => ({
  ThreadTimelinePane({ footer, header }: MockThreadTimelinePaneProps) {
    return (
      <main>
        {header}
        Timeline
        {footer}
      </main>
    );
  },
}));

const noop = () => {};

function noopAssignManager(_parentThreadId: string | null): void {}

function noopBranchChange(_branch: string): void {}

function noopSecondaryPanelChange(_panel: ThreadSecondaryPanelTab): void {}

function noopOpenFile(_path: string): void {}

function noopLoadTurnSummaryRows(_entry: TimelineTurnRow): void {}

function makeThread(): Thread {
  return {
    id: "thr_test",
    projectId: "proj_test",
    environmentId: "env_test",
    automationId: null,
    providerId: "openai",
    type: "standard",
    title: "Test thread",
    titleFallback: null,
    status: "idle",
    parentThreadId: null,
    archivedAt: null,
    pinnedAt: null,
    stopRequestedAt: null,
    deletedAt: null,
    lastReadAt: null,
    latestAttentionAt: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

function renderContent(onTerminalPanelResize: TerminalPanelResizeHandler) {
  return render(
    <ThreadDetailSecondaryContent
      footer={<div>Footer</div>}
      header={<div>Header</div>}
      isMetadataLoading={false}
      isSecondaryPanelOpen={false}
      metadata={{
        thread: makeThread(),
        projectId: "proj_test",
        parentThreadDisplayName: null,
        managerThreads: [],
        canAssignToManager: false,
        canTakeOverThread: false,
        environmentHost: null,
        environmentIsLocal: true,
        environment: null,
        workspaceStatus: undefined,
        workspaceStatusError: null,
        selectedMergeBaseBranch: undefined,
        mergeBaseBranchOptions: undefined,
        isLoadingMergeBaseBranchOptions: false,
        updateThreadPending: false,
        onAssignManager: noopAssignManager,
        onMergeBaseBranchChange: noopBranchChange,
      }}
      secondaryPanel={{
        activePanel: null,
        canUseGitUi: false,
        defaultMergeBaseBranch: undefined,
        environmentId: undefined,
        fileTabs: undefined,
        fileTabContent: undefined,
        isOpen: false,
        showGitDiffTab: false,
        workspaceRootPath: undefined,
        onClose: noop,
        onCollapse: noop,
        onOpenFileInEditor: noopOpenFile,
        onOpenFilePreview: noopOpenFile,
        onOpenNewTab: noop,
        onPanelChange: noopSecondaryPanelChange,
        onPanelFocus: noop,
      }}
      terminalPanel={<div>Terminal</div>}
      terminalPanelHeightPercent={32}
      terminalPanelOpen
      onTerminalPanelResize={onTerminalPanelResize}
      timeline={{
        activeThinking: null,
        hasOlderTimelineRows: false,
        hostConnectionNotice: null,
        isLoadingOlderTimelineRows: false,
        isThreadTimelinePending: false,
        timelineError: false,
        loadingTurnSummaryIds: new Set<string>(),
        erroredTurnSummaryIds: new Set<string>(),
        onLoadOlderRows: noop,
        onLoadTurnSummaryRows: noopLoadTurnSummaryRows,
        projectId: "proj_test",
        showOngoingIndicator: false,
        stopRequestedAt: null,
        timelineRows: [],
        threadId: "thr_test",
        threadRuntimeDisplayStatus: "idle",
        turnSummaryRowsIdentity: "empty",
        turnSummaryRowsById: {},
        unreadDividerAutoScroll: false,
        unreadDividerPlacement: null,
        workspaceRootPath: undefined,
      }}
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ThreadDetailSecondaryContent", () => {
  it("persists terminal size immediately outside an active drag", () => {
    const onTerminalPanelResize = vi.fn();
    renderContent(onTerminalPanelResize);

    fireEvent.click(
      screen.getByRole("button", {
        name: "Resize thread-detail-terminal-panel to 45",
      }),
    );

    expect(onTerminalPanelResize).toHaveBeenCalledTimes(1);
    expect(onTerminalPanelResize).toHaveBeenCalledWith(45);
  });

  it("defers terminal size persistence until drag end", () => {
    const onTerminalPanelResize = vi.fn();
    renderContent(onTerminalPanelResize);

    fireEvent.click(
      screen.getByRole("button", { name: "Start terminal panel drag" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: "Resize thread-detail-terminal-panel to 45",
      }),
    );

    expect(onTerminalPanelResize).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "End terminal panel drag" }),
    );

    expect(onTerminalPanelResize).toHaveBeenCalledTimes(1);
    expect(onTerminalPanelResize).toHaveBeenCalledWith(45);
  });
});
