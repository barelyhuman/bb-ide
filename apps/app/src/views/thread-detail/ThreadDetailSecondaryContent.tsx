import { type ComponentProps, type ReactNode, useEffect, useRef } from "react";
import { Panel, PanelGroup } from "react-resizable-panels";
import type { WorkspaceFile } from "@bb/server-contract";
import { ResponsiveDrawerShell } from "@/components/ui";
import { useIsCompactViewport } from "@/components/ui";
import { useAtomValue } from "jotai";
import { useIsSecondaryPanelOpen } from "@/lib/thread-secondary-panel";
import { ThreadSecondaryPanel } from "@/components/secondary-panel/ThreadSecondaryPanel";
import { secondaryPanelWidthPercentAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { ManagerThreadStorageBrowser } from "@/components/secondary-panel/ManagerThreadStorageBrowser";
import {
  ThreadMetadataContent,
  hasAnyThreadMetadata,
  type ThreadMetadataContentProps,
} from "@/components/secondary-panel/ThreadMetadataContent";
import { ThreadTimelinePane } from "./ThreadTimelinePane";
import type { FilePreview } from "@/lib/file-preview";

const CLOSED_TIMELINE_PANEL_SIZE_PERCENT = 100;

type ThreadTimelinePaneProps = Omit<
  ComponentProps<typeof ThreadTimelinePane>,
  "footer" | "header"
>;
type ThreadSecondaryPanelProps = Omit<
  ComponentProps<typeof ThreadSecondaryPanel>,
  "threadStorageContent" | "metadataContent" | "renderAsDrawer"
>;

type ThreadStoragePathSelectHandler = (path: string) => void;

interface ThreadDetailThreadStorageProps {
  fileError?: Error | null;
  filePreview?: FilePreview;
  filesError?: Error | null;
  files?: readonly WorkspaceFile[];
  isFilesLoading: boolean;
  isFileLoading: boolean;
  onSelectPath: ThreadStoragePathSelectHandler;
  selectedPath: string | null;
  truncated: boolean;
}

interface ThreadDetailSecondaryContentProps {
  footer: ReactNode;
  header: ReactNode;
  threadStorage?: ThreadDetailThreadStorageProps;
  metadata: ThreadMetadataContentProps;
  secondaryPanel: ThreadSecondaryPanelProps;
  timeline: ThreadTimelinePaneProps;
}

export function ThreadDetailSecondaryContent({
  footer,
  header,
  threadStorage,
  metadata,
  secondaryPanel,
  timeline,
}: ThreadDetailSecondaryContentProps) {
  const renderAsDrawer = useIsCompactViewport();
  const isSecondaryPanelOpen = useIsSecondaryPanelOpen();
  const persistedSecondaryWidthPercent = useAtomValue(
    secondaryPanelWidthPercentAtom,
  );
  const didResetOnDrawerRef = useRef(false);
  const { onClose } = secondaryPanel;

  useEffect(() => {
    if (!renderAsDrawer) {
      didResetOnDrawerRef.current = false;
      return;
    }
    if (didResetOnDrawerRef.current) return;
    didResetOnDrawerRef.current = true;
    if (isSecondaryPanelOpen) {
      onClose();
    }
  }, [renderAsDrawer, isSecondaryPanelOpen, onClose]);

  const metadataContent = hasAnyThreadMetadata(metadata) ? (
    <ThreadMetadataContent {...metadata} />
  ) : (
    <div className="pt-1 text-sm text-muted-foreground">
      No thread details available.
    </div>
  );
  const threadStorageContent = threadStorage ? (
    <ManagerThreadStorageBrowser {...threadStorage} />
  ) : undefined;
  const inlineSecondaryPanelContent = !renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...secondaryPanel}
      renderAsDrawer={false}
      metadataContent={metadataContent}
      threadStorageContent={threadStorageContent}
    />
  ) : null;
  const drawerSecondaryPanelContent = renderAsDrawer ? (
    <ThreadSecondaryPanel
      {...secondaryPanel}
      renderAsDrawer={true}
      metadataContent={metadataContent}
      threadStorageContent={threadStorageContent}
    />
  ) : null;

  return (
    <div className="-mx-4 -mb-4 -mt-4 flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <PanelGroup
        direction="horizontal"
        className="h-full w-full min-w-0"
      >
        <Panel
          id="thread-detail-timeline-panel"
          defaultSize={
            isSecondaryPanelOpen && !renderAsDrawer
              ? 100 - persistedSecondaryWidthPercent
              : CLOSED_TIMELINE_PANEL_SIZE_PERCENT
          }
          minSize={30}
          order={1}
          className="min-w-0 overflow-hidden"
        >
          <ThreadTimelinePane {...timeline} footer={footer} header={header} />
        </Panel>
        {inlineSecondaryPanelContent}
      </PanelGroup>
      {renderAsDrawer ? (
        <ResponsiveDrawerShell
          open={isSecondaryPanelOpen}
          onOpenChange={(open) => {
            if (!open) secondaryPanel.onClose();
          }}
          srLabel="Thread details"
          contentClassName="h-[92dvh] max-h-[92dvh]"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {drawerSecondaryPanelContent}
          </div>
        </ResponsiveDrawerShell>
      ) : null}
    </div>
  );
}
