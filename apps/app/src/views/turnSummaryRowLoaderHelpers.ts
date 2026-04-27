export interface NestedRowLoadState {
  cachedRowCount: number;
  inlineRowCount: number;
  isLoading: boolean;
  threadId?: string;
}

export function shouldLoadNestedRows(state: NestedRowLoadState): boolean {
  return (
    Boolean(state.threadId) &&
    state.inlineRowCount === 0 &&
    state.cachedRowCount === 0 &&
    !state.isLoading
  );
}
