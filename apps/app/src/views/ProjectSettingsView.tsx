import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  findLocalPathProjectSourceForHost,
  isLocalPathProjectSource,
  type LocalPathProjectSource,
  type ProjectSource,
} from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import { PageShell } from "@/components/ui/page-shell.js";
import { ProjectPathDialog } from "@/components/dialogs/ProjectPathDialog";
import {
  ProjectSourceDeleteDialog,
  type ProjectSourceDeleteDialogTarget,
} from "@/components/dialogs/ProjectSourceDeleteDialog";
import {
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section.js";
import { ProjectSourceRow } from "@/views/project-settings/ProjectSourceRow";
import {
  useAddLocalProjectSource,
  useUpdateLocalProjectSource,
} from "@/hooks/mutations/project-mutations";
import {
  isLocalPathMissing,
  useLocalPathExistence,
} from "@/hooks/queries/host-path-queries";
import {
  useLocalPathPicker,
  type LocalPathSubmitParams,
} from "@/hooks/useLocalPathPicker";
import {
  stripProjectThreads,
  useSidebarNavigation,
} from "@/hooks/queries/project-queries";
import { useEffectiveHosts } from "@/hooks/queries/effective-hosts";
import { invalidateProjectSourceQueries } from "@/hooks/cache-effects";
import * as api from "@/lib/api";

interface DeleteProjectSourceMutationRequest {
  sourceId: string;
}

function sourceLabel(
  source: ProjectSource,
  hostNameById: Map<string, string>,
): string {
  return hostNameById.get(source.hostId) ?? source.hostId;
}

export function ProjectSettingsView() {
  const { projectId } = useParams<{ projectId: string }>();
  const sidebarNavigationQuery = useSidebarNavigation();
  const projects = useMemo(
    () => sidebarNavigationQuery.data?.projects.map(stripProjectThreads),
    [sidebarNavigationQuery.data],
  );
  const isLoading = sidebarNavigationQuery.isFetching && projects === undefined;
  const { data: hosts = [] } = useEffectiveHosts();
  const queryClient = useQueryClient();

  const [deleteTarget, setDeleteTarget] =
    useState<ProjectSourceDeleteDialogTarget | null>(null);

  const deleteSource = useMutation({
    meta: {
      errorMessage: "Failed to remove source.",
    },
    mutationFn: ({ sourceId }: DeleteProjectSourceMutationRequest) => {
      if (!projectId) return Promise.resolve();
      return api.removeProjectSource(projectId, sourceId);
    },
    onSuccess: () => {
      invalidateProjectSourceQueries({ projectId, queryClient });
      setDeleteTarget(null);
    },
  });

  const addLocalSource = useAddLocalProjectSource();
  const updateLocalSource = useUpdateLocalProjectSource();

  const project = projects?.find((p) => p.id === projectId);
  const projectSources = project?.sources;
  const sources = useMemo(() => projectSources ?? [], [projectSources]);
  const hostNameById = useMemo(
    () => new Map(hosts.map((h) => [h.id, h.name])),
    [hosts],
  );

  const projectName = project?.name ?? "";
  const localSourcePickerPending =
    addLocalSource.isPending || updateLocalSource.isPending;
  const localSourceSubmit = useCallback(
    ({ path, hostId, target, closeDialog }: LocalPathSubmitParams) => {
      if (!projectId) return;
      if (target.kind === "add-source") {
        addLocalSource.mutate(
          { projectId, path, hostId },
          { onSuccess: closeDialog },
        );
      } else if (target.kind === "update") {
        const source = sources.find(
          (candidate): candidate is LocalPathProjectSource =>
            isLocalPathProjectSource(candidate) && candidate.hostId === hostId,
        );
        if (!source) return;
        updateLocalSource.mutate(
          { projectId, sourceId: source.id, path },
          { onSuccess: closeDialog },
        );
      }
    },
    [addLocalSource, projectId, sources, updateLocalSource],
  );
  const localSourcePicker = useLocalPathPicker({
    isPending: localSourcePickerPending,
    submit: localSourceSubmit,
  });
  const openAddLocalSourcePicker = useCallback(() => {
    if (!projectId) return;
    localSourcePicker.openPicker({
      kind: "add-source",
      projectId,
      projectName,
    });
  }, [localSourcePicker, projectId, projectName]);
  const openEditLocalSourcePicker = useCallback(
    (source: LocalPathProjectSource) => {
      if (!projectId) return;
      localSourcePicker.openPicker({
        kind: "update",
        projectId,
        projectName,
        currentPath: source.path,
      });
    },
    [localSourcePicker, projectId, projectName],
  );
  const localDaemonHostId = localSourcePicker.localDaemonHostId;

  const localDaemonSourcePaths = useMemo(() => {
    if (!localDaemonHostId) return [];
    return sources
      .filter(
        (source): source is LocalPathProjectSource =>
          isLocalPathProjectSource(source) &&
          source.hostId === localDaemonHostId,
      )
      .map((source) => source.path);
  }, [localDaemonHostId, sources]);
  const pathExistence = useLocalPathExistence(localDaemonSourcePaths);

  const showAddLocalSourceButton =
    localDaemonHostId != null &&
    !findLocalPathProjectSourceForHost(sources, localDaemonHostId);

  const addSourceButtons = showAddLocalSourceButton ? (
    <div className="mt-2 flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={addLocalSource.isPending}
        onClick={openAddLocalSourcePicker}
      >
        Add local path
      </Button>
    </div>
  ) : null;

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <div className="mx-auto w-full max-w-3xl space-y-6">
        <SettingsSection title="Project Sources">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : sources.length === 0 ? (
            <div>
              <p className="text-sm text-muted-foreground">
                No sources configured.
              </p>
              {addSourceButtons}
            </div>
          ) : (
            <div>
              <SettingsRowList>
                {sources.map((source) => {
                  const isLocalDaemonSource =
                    isLocalPathProjectSource(source) &&
                    localDaemonHostId != null &&
                    source.hostId === localDaemonHostId;
                  const isInvalid =
                    isLocalDaemonSource &&
                    isLocalPathMissing(pathExistence, source.path);
                  const hostName = isLocalPathProjectSource(source)
                    ? (hostNameById.get(source.hostId) ?? source.hostId)
                    : "";
                  return (
                    <ProjectSourceRow
                      key={source.id}
                      source={source}
                      isLocalhostSource={isLocalDaemonSource}
                      isLocalPathInvalid={isInvalid}
                      hostName={hostName}
                      isEditPending={localSourcePickerPending}
                      isOnlySource={sources.length <= 1}
                      onEditLocalPath={openEditLocalSourcePicker}
                      onRemove={(target) =>
                        setDeleteTarget({
                          id: target.id,
                          label: sourceLabel(target, hostNameById),
                        })
                      }
                    />
                  );
                })}
              </SettingsRowList>
              {addSourceButtons}
            </div>
          )}
        </SettingsSection>
      </div>

      <ProjectPathDialog
        target={localSourcePicker.projectPathDialog.target}
        pending={localSourcePickerPending}
        platform={localSourcePicker.platform}
        onOpenChange={localSourcePicker.projectPathDialog.onOpenChange}
        onSubmit={localSourcePicker.submitProjectPath}
      />

      <ProjectSourceDeleteDialog
        target={deleteTarget}
        pending={deleteSource.isPending}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        onDelete={(sourceId) => deleteSource.mutate({ sourceId })}
      />
    </PageShell>
  );
}
