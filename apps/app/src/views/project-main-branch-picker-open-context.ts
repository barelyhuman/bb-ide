export interface ProjectMainBranchPickerOpenContext {
  environmentValue: string;
  projectId: string | undefined;
}

export interface IsProjectMainBranchPickerOpenForContextArgs {
  environmentValue: string;
  openedFor: ProjectMainBranchPickerOpenContext | null;
  projectId: string | undefined;
}

export function isProjectMainBranchPickerOpenForContext({
  environmentValue,
  openedFor,
  projectId,
}: IsProjectMainBranchPickerOpenForContextArgs): boolean {
  if (!projectId || !openedFor) {
    return false;
  }

  return (
    openedFor.projectId === projectId &&
    openedFor.environmentValue === environmentValue
  );
}
