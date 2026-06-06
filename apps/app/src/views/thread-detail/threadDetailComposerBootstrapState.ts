export interface ResolveThreadComposerBootstrapReadyArgs {
  hasData: boolean;
  isError: boolean;
  isFetching: boolean;
  isSuccess: boolean;
}

export function resolveThreadComposerBootstrapReady({
  hasData,
  isError,
  isFetching,
  isSuccess,
}: ResolveThreadComposerBootstrapReadyArgs): boolean {
  if (hasData) {
    return true;
  }

  return !isFetching && (isSuccess || isError);
}
