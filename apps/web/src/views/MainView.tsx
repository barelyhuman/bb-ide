import { Navigate } from "react-router-dom";
import { useProjects } from "../hooks/useApi";
import { Button } from "@/components/ui/button";
import { useQuickCreateProject } from "@/hooks/useQuickCreateProject";

export function MainView() {
  const { data: projects, isLoading: projectsLoading } = useProjects();
  const { createFromPicker, isCreating } = useQuickCreateProject();
  const hasProjects = (projects?.length ?? 0) > 0;

  if (projectsLoading) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading projects...</p>
      </div>
    );
  }

  if (!hasProjects) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-sm text-muted-foreground">
            Create a new project to get started
          </p>
          <Button
            onClick={() => {
              void createFromPicker();
            }}
            disabled={isCreating}
          >
            {isCreating ? "Creating..." : "New project"}
          </Button>
        </div>
      </div>
    );
  }

  return <Navigate to={`/projects/${projects![0].id}`} replace />;
}
