const THREAD_SECONDARY_PANEL_QUERY_KEY = "secondaryPanel";
const THREAD_GIT_DIFF_PANEL_QUERY_VALUE = "git-diff";

export function isThreadGitDiffPanelOpen(search: string): boolean {
  const params = new URLSearchParams(search);
  return params.get(THREAD_SECONDARY_PANEL_QUERY_KEY) === THREAD_GIT_DIFF_PANEL_QUERY_VALUE;
}

export function withThreadGitDiffPanelOpen(search: string, open: boolean): string {
  const params = new URLSearchParams(search);
  if (open) {
    params.set(THREAD_SECONDARY_PANEL_QUERY_KEY, THREAD_GIT_DIFF_PANEL_QUERY_VALUE);
  } else if (params.get(THREAD_SECONDARY_PANEL_QUERY_KEY) === THREAD_GIT_DIFF_PANEL_QUERY_VALUE) {
    params.delete(THREAD_SECONDARY_PANEL_QUERY_KEY);
  }
  return params.toString();
}
