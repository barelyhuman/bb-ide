const THREAD_SECONDARY_PANEL_QUERY_KEY = "secondaryPanel";
const THREAD_DIFF_PANEL_QUERY_VALUE = "git-diff";
const THREAD_INFO_PANEL_QUERY_VALUE = "thread-info";

export type ThreadSecondaryPanel = "git-diff" | "thread-info";

function decodeThreadSecondaryPanel(
  value: string | null,
): ThreadSecondaryPanel | null {
  switch (value) {
    case THREAD_DIFF_PANEL_QUERY_VALUE:
      return "git-diff";
    case THREAD_INFO_PANEL_QUERY_VALUE:
      return "thread-info";
    default:
      return null;
  }
}

export function getThreadSecondaryPanel(
  search: string,
): ThreadSecondaryPanel | null {
  const params = new URLSearchParams(search);
  return decodeThreadSecondaryPanel(
    params.get(THREAD_SECONDARY_PANEL_QUERY_KEY),
  );
}

export function withThreadSecondaryPanel(
  search: string,
  panel: ThreadSecondaryPanel | null,
): string {
  const params = new URLSearchParams(search);
  if (panel) {
    params.set(THREAD_SECONDARY_PANEL_QUERY_KEY, panel);
  } else {
    params.delete(THREAD_SECONDARY_PANEL_QUERY_KEY);
  }
  return params.toString();
}
