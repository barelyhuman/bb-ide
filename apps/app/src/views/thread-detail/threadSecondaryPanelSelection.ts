import { useCallback } from "react";
import {
  useClearFixedSecondaryPanelActiveTab,
  useSetFixedSecondaryPanelTab,
} from "@/lib/fixed-panel-tabs";
import type {
  FixedPanelTab,
  FixedPanelTabsState,
} from "@/lib/fixed-panel-tabs-state";
import {
  useSetThreadSecondaryPanel,
  type ThreadSecondaryPanel,
} from "@/lib/thread-secondary-panel";

type ThreadSecondaryPanelThreadId = string | null | undefined;
type ActiveFixedPanelTab = FixedPanelTab | null;
type ActiveThreadSecondaryPanel = ThreadSecondaryPanel | null;

type NullableSecondaryPanelSetter = (panel: ActiveThreadSecondaryPanel) => void;

interface GetActiveFixedSecondaryTabArgs {
  fixedPanelTabsState: FixedPanelTabsState;
}

interface GetActiveThreadSecondaryPanelArgs {
  activeFixedSecondaryTab: ActiveFixedPanelTab;
  legacyActivePanel: ActiveThreadSecondaryPanel;
}

export function getActiveFixedSecondaryTab({
  fixedPanelTabsState,
}: GetActiveFixedSecondaryTabArgs): ActiveFixedPanelTab {
  const activeTabId = fixedPanelTabsState.secondary.activeTabId;
  if (activeTabId === null) {
    return null;
  }
  return (
    fixedPanelTabsState.secondary.tabs.find((tab) => tab.id === activeTabId) ??
    null
  );
}

function getSecondaryPanelForFixedTab(
  tab: ActiveFixedPanelTab,
): ActiveThreadSecondaryPanel {
  if (tab === null) {
    return null;
  }
  switch (tab.kind) {
    case "thread-info":
      return "thread-info";
    case "git-diff":
      return "git-diff";
    case "workspace-file-preview":
    case "host-file-preview":
    case "thread-storage-file-preview":
      return "thread-info";
    case "terminal":
      return null;
  }
}

export function getActiveThreadSecondaryPanel({
  activeFixedSecondaryTab,
  legacyActivePanel,
}: GetActiveThreadSecondaryPanelArgs): ActiveThreadSecondaryPanel {
  return (
    getSecondaryPanelForFixedTab(activeFixedSecondaryTab) ?? legacyActivePanel
  );
}

export function useSetThreadSecondaryPanelSelection(
  threadId: ThreadSecondaryPanelThreadId,
): NullableSecondaryPanelSetter {
  const clearFixedSecondaryPanelActiveTab =
    useClearFixedSecondaryPanelActiveTab(threadId);
  const setFixedSecondaryPanelTab = useSetFixedSecondaryPanelTab(threadId);
  const setLegacySecondaryPanel = useSetThreadSecondaryPanel(threadId);

  return useCallback<NullableSecondaryPanelSetter>(
    (panel) => {
      if (panel === null) {
        clearFixedSecondaryPanelActiveTab();
        setLegacySecondaryPanel(null);
        return;
      }
      setFixedSecondaryPanelTab(panel);
      setLegacySecondaryPanel(panel);
    },
    [
      clearFixedSecondaryPanelActiveTab,
      setFixedSecondaryPanelTab,
      setLegacySecondaryPanel,
    ],
  );
}
