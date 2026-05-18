import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

interface UseCreateThreadInWorktreeArgs {
  projectId: string;
  environmentId: string;
}

// Navigates to the project's new-thread page and signals the env id via
// transient location.state. ProjectMainView consumes it once on mount,
// seeds the picker to reuse mode for that env, and clears state — refresh
// reverts to the user's host-mode default. Reuse intent is never persisted
// to localStorage or to project-level server defaults.
export function useCreateThreadInWorktree({
  projectId,
  environmentId,
}: UseCreateThreadInWorktreeArgs): () => void {
  const navigate = useNavigate();
  return useCallback(() => {
    navigate(`/projects/${projectId}`, {
      state: { reuseEnvironmentId: environmentId },
    });
  }, [environmentId, navigate, projectId]);
}
