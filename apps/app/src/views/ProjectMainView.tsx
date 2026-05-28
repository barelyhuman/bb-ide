import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  findLocalPathProjectSourceForHost,
  type ThreadListEntry,
} from "@bb/domain";
import {
  NewThreadPromptBox,
  type ThreadCreationMode,
} from "@/components/promptbox/NewThreadPromptBox";
import {
  encodeHostValue,
  encodeReuseValue,
  parseEnvironmentValue,
} from "@/components/pickers/environment-picker-value";
import type { ProjectSelectorOption } from "@/components/pickers/ProjectSelector";
import type { ReuseThreadOption } from "@/components/pickers/WorktreePicker";
import { Icon } from "@/components/ui/icon.js";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  useHireProjectManager,
  useUploadPromptAttachment,
} from "@/hooks/mutations/project-mutations";
import { useCreateThread } from "@/hooks/mutations/thread-runtime-mutations";
import {
  useProjectPromptHistory,
  useProjectSourceBranches,
  useProjects,
  useSidebarBootstrap,
  stripProjectThreads,
} from "@/hooks/queries/project-queries";
import { useEffectiveHosts } from "@/hooks/queries/effective-hosts";
import { useManagerTemplates } from "@/hooks/queries/system-queries";
import { useThreads } from "@/hooks/queries/thread-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { usePromptDraftStorage } from "@/hooks/usePromptDraftStorage";
import { usePromptMentions } from "@/hooks/usePromptMentions";
import { useThreadCreationOptions } from "@/hooks/useThreadCreationOptions";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import { useNewThreadModePreference } from "@/lib/new-thread-mode-preference";
import { promptHistoryEntriesToDrafts } from "@/lib/prompt-history";
import { getProjectScopedStorageKey } from "@/lib/project-scoped-storage";
import { promptDraftToInput } from "@/lib/prompt-draft";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  buildProjectMainBranchUiState,
  type ProjectMainBranchEnvironmentMode,
} from "./project-main-branch-ui";
import { resolveProjectMainThreadEnvironment } from "./project-main-thread-environment";
import { useScopedBranchSelection } from "./project-main-branch-selection";

const PROJECT_MAIN_ZEN_MODE_STORAGE_KEY = "bb.promptbox.zen-mode.project-main";

// react-router's location.state is freeform unknown — narrow it here at the
// system boundary before reading.
function readReuseEnvironmentIdFromLocationState(
  state: unknown,
): string | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { reuseEnvironmentId?: unknown })
    .reuseEnvironmentId;
  if (typeof candidate === "string" && candidate.length > 0) return candidate;
  return null;
}

function readModeFromLocationState(state: unknown): ThreadCreationMode | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as { mode?: unknown }).mode;
  return candidate === "manager" || candidate === "thread" ? candidate : null;
}

function isWorktreeWithEnv(thread: ThreadListEntry): boolean {
  if (thread.environmentId === null) return false;
  return (
    thread.environmentWorkspaceDisplayKind === "managed-worktree" ||
    thread.environmentWorkspaceDisplayKind === "unmanaged-worktree"
  );
}

function buildReuseThreadOptions(
  threads: readonly ThreadListEntry[],
): ReuseThreadOption[] {
  // One option per worktree env. Threads within each env are sorted
  // most-recently-active first so the picker preview surfaces the threads
  // the user is most likely to recognize. Only unarchived threads reach
  // here — `useThreads({ archived: false })` filters at the source. Envs
  // with no unarchived threads naturally drop out.
  const threadsByEnvironmentId = new Map<string, ThreadListEntry[]>();
  const branchByEnvironmentId = new Map<string, string | null>();
  for (const thread of threads) {
    if (!isWorktreeWithEnv(thread)) continue;
    if (thread.environmentId === null) continue;
    let bucket = threadsByEnvironmentId.get(thread.environmentId);
    if (!bucket) {
      bucket = [];
      threadsByEnvironmentId.set(thread.environmentId, bucket);
      branchByEnvironmentId.set(
        thread.environmentId,
        thread.environmentBranchName,
      );
    }
    bucket.push(thread);
  }
  const options: ReuseThreadOption[] = [];
  for (const [environmentId, bucket] of threadsByEnvironmentId) {
    bucket.sort(
      (left, right) => right.latestAttentionAt - left.latestAttentionAt,
    );
    options.push({
      environmentId,
      branchName: branchByEnvironmentId.get(environmentId) ?? null,
      threads: bucket.map((thread) => ({
        id: thread.id,
        title: getThreadDisplayTitle(thread),
      })),
    });
  }
  options.sort((left, right) => {
    if (left.branchName && right.branchName) {
      return left.branchName.localeCompare(right.branchName);
    }
    return left.environmentId.localeCompare(right.environmentId);
  });
  return options;
}

export function ProjectMainView() {
  const { projectId } = useParams<{ projectId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarBootstrapQuery = useSidebarBootstrap();
  const hasSidebarBootstrapSettled =
    sidebarBootstrapQuery.isSuccess || sidebarBootstrapQuery.isError;
  const projectsQuery = useProjects({ enabled: hasSidebarBootstrapSettled });
  const sidebarBootstrapProjects = useMemo(
    () => sidebarBootstrapQuery.data?.projects.map(stripProjectThreads),
    [sidebarBootstrapQuery.data],
  );
  const projects = projectsQuery.data ?? sidebarBootstrapProjects;
  const createThread = useCreateThread();
  const hireProjectManager = useHireProjectManager();
  const { isLocalHost, localHostId } = useHostDaemon();
  const hostsQuery = useEffectiveHosts();
  const hosts = useMemo(() => hostsQuery.data ?? [], [hostsQuery.data]);
  const managerTemplatesQuery = useManagerTemplates();
  const managerTemplates = useMemo(
    () => managerTemplatesQuery.data?.templates ?? [],
    [managerTemplatesQuery.data?.templates],
  );
  const managerTemplateActiveName =
    managerTemplatesQuery.data?.activeName ?? null;
  const uploadPromptAttachment = useUploadPromptAttachment();
  const promptDraft = usePromptDraftStorage({ projectId, threadId: null });
  const { data: projectPromptHistory = [] } =
    useProjectPromptHistory(projectId);
  const promptMentions = usePromptMentions(projectId, { environmentId: null });
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  // Thread / manager mode for the header switcher above the prompt-box.
  // Persisted across visits so the user lands on whichever mode they used
  // last; the sidebar's "New Manager" affordance still seeds "manager" via
  // router state below, which writes through the same setter.
  const [mode, setModeRaw] = useNewThreadModePreference();
  // Manager-mode selections. Held as raw user choices; the effective values
  // resolved against the loaded hosts / templates are computed below so a
  // stale selection (host disconnects, template removed) falls back to a
  // safe default without an effect.
  const [managerHostSelection, setManagerHostSelection] = useState<string>("");
  const [managerTemplateSelection, setManagerTemplateSelection] =
    useState<string>("");
  const prompt = promptDraft.text;
  const promptInput = useMemo(
    () =>
      promptDraftToInput({
        text: promptDraft.text,
        attachments: promptDraft.attachments,
      }),
    [promptDraft.attachments, promptDraft.text],
  );
  const projectMainZenModeStorageKey = useMemo(
    () =>
      getProjectScopedStorageKey(PROJECT_MAIN_ZEN_MODE_STORAGE_KEY, projectId),
    [projectId],
  );
  const promptHistoryDrafts = useMemo(
    () => promptHistoryEntriesToDrafts(projectPromptHistory),
    [projectPromptHistory],
  );
  const {
    selectedProviderId,
    setSelectedProviderId,
    providerOptions,
    hasMultipleProviders,
    selectedModel,
    setSelectedModel,
    serviceTier,
    setServiceTier,
    reasoningLevel,
    setReasoningLevel,
    permissionMode,
    setPermissionMode,
    environmentSelectionValue,
    setEnvironmentSelectionValue,
    clearReuseEnvironment,
    activeModel,
    modelOptions,
    modelLoadError,
    reasoningOptions,
    permissionModeOptions,
    supportsPermissionModeSelection,
    supportsServiceTier,
    serviceTierSupportByProvider,
  } = useThreadCreationOptions({ scope: "new-thread", projectId });

  // All mode transitions go through this wrapper. Manager threads have no
  // environment, so a reuse-env selection is invalid in manager mode —
  // clear it at the transition rather than letting it survive (hidden) on
  // the env atom. The discriminated union at the prop boundary stops
  // invalid combinations from rendering; this clears the state so toggling
  // back to thread doesn't resurface a stale reuse selection.
  const setMode = useCallback(
    (next: ThreadCreationMode) => {
      setModeRaw(next);
      if (next === "manager") {
        clearReuseEnvironment();
      }
    },
    [clearReuseEnvironment, setModeRaw],
  );

  // Seed transient picker state from the sidebar navigation's router state:
  // `reuseEnvironmentId` (the "+" affordance on a worktree) seeds the env
  // picker into reuse mode for that env, and `mode` (the sidebar's
  // "New Manager" button) seeds the mode picker to "manager". Both are
  // single-use — clear location.state after applying so a refresh starts
  // from defaults.
  useEffect(() => {
    const reuseEnvironmentId = readReuseEnvironmentIdFromLocationState(
      location.state,
    );
    const seededMode = readModeFromLocationState(location.state);
    if (reuseEnvironmentId === null && seededMode === null) return;
    if (reuseEnvironmentId !== null) {
      setEnvironmentSelectionValue(encodeReuseValue(reuseEnvironmentId));
    }
    if (seededMode !== null) {
      setMode(seededMode);
    }
    navigate(location.pathname + location.search, {
      replace: true,
      state: null,
    });
  }, [
    location.pathname,
    location.search,
    location.state,
    navigate,
    setEnvironmentSelectionValue,
    setMode,
  ]);

  // Worktree picker options come from the project's unarchived threads.
  // Threads on managed or unmanaged worktrees with a non-null environmentId
  // contribute; envs with only archived threads disappear naturally.
  const threadsQuery = useThreads(
    { projectId, archived: false },
    { enabled: Boolean(projectId) },
  );
  const reuseThreadOptions = useMemo(
    () => buildReuseThreadOptions(threadsQuery.data ?? []),
    [threadsQuery.data],
  );

  const currentProject = useMemo(
    () => projects?.find((p) => p.id === projectId),
    [projects, projectId],
  );
  const projectSources = useMemo(
    () => currentProject?.sources ?? [],
    [currentProject?.sources],
  );

  // Manager hosting: a host is eligible iff it's connected AND has a
  // local-path source for the project. The hire flow uses the eligible
  // selection (or a default) so the user can pick across hosts once we
  // surface them.
  const eligibleManagerHosts = useMemo(
    () =>
      hosts.filter(
        (host) =>
          host.status === "connected" &&
          findLocalPathProjectSourceForHost(projectSources, host.id) !==
            undefined,
      ),
    [hosts, projectSources],
  );
  const defaultManagerHostId = useMemo(() => {
    const local = eligibleManagerHosts.find((host) => isLocalHost(host.id));
    return local?.id ?? eligibleManagerHosts[0]?.id ?? "";
  }, [eligibleManagerHosts, isLocalHost]);
  const effectiveManagerHostId = useMemo(() => {
    const isEligible = eligibleManagerHosts.some(
      (host) => host.id === managerHostSelection,
    );
    return managerHostSelection && isEligible
      ? managerHostSelection
      : defaultManagerHostId;
  }, [defaultManagerHostId, eligibleManagerHosts, managerHostSelection]);

  const defaultManagerTemplateName = useMemo(() => {
    if (
      managerTemplateActiveName !== null &&
      managerTemplates.some(
        (template) => template.name === managerTemplateActiveName,
      )
    ) {
      return managerTemplateActiveName;
    }
    return managerTemplates[0]?.name ?? "";
  }, [managerTemplateActiveName, managerTemplates]);
  const effectiveManagerTemplateName = useMemo(() => {
    const isKnown = managerTemplates.some(
      (template) => template.name === managerTemplateSelection,
    );
    return managerTemplateSelection && isKnown
      ? managerTemplateSelection
      : defaultManagerTemplateName;
  }, [defaultManagerTemplateName, managerTemplateSelection, managerTemplates]);

  // The hook returns reuse values from session-only state and sanitizes any
  // legacy reuse entries out of localStorage, so we can take its value
  // verbatim and fall back to the local-host default only when nothing's
  // selected.
  const effectiveEnvironmentValue = useMemo(() => {
    if (
      environmentSelectionValue &&
      parseEnvironmentValue(environmentSelectionValue)
    ) {
      return environmentSelectionValue;
    }
    if (localHostId) {
      return encodeHostValue(localHostId, "local");
    }
    return "";
  }, [environmentSelectionValue, localHostId]);
  const parsedEnvironment = useMemo(
    () => parseEnvironmentValue(effectiveEnvironmentValue),
    [effectiveEnvironmentValue],
  );
  const [branchSearchQuery, setBranchSearchQuery] = useState("");
  useEffect(() => {
    setBranchSearchQuery("");
  }, [effectiveEnvironmentValue, projectId]);
  const isHostMode = parsedEnvironment?.type === "host";
  const {
    selectedBranch,
    onBranchChange: handleBranchChange,
    onClearBranch: handleClearBranch,
    onCreateBranch: handleCreateBranch,
    onCreateBranchFrom: handleCreateBranchFrom,
  } = useScopedBranchSelection({
    environmentValue: effectiveEnvironmentValue,
    projectId,
  });
  const selectedBranchName = selectedBranch?.name ?? "";
  const hostBranchesQuery = useProjectSourceBranches(
    projectId,
    isHostMode ? parsedEnvironment.hostId : null,
    {
      enabled: isHostMode,
      query: branchSearchQuery,
      selectedBranch: selectedBranchName,
    },
  );
  const activeBranchesQuery = hostBranchesQuery;
  const branchOptions = useMemo(() => {
    const branches = activeBranchesQuery.data?.branches ?? [];
    const selectedRef = activeBranchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "local" && !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    activeBranchesQuery.data?.branches,
    activeBranchesQuery.data?.selectedBranch,
  ]);
  const isHostLocalMode = isHostMode && parsedEnvironment.mode === "local";
  const branchEnvironmentMode: ProjectMainBranchEnvironmentMode =
    isHostLocalMode
      ? "local"
      : isHostMode && parsedEnvironment.mode === "worktree"
        ? "worktree"
        : "other";
  const remoteBranchOptions = useMemo(() => {
    if (
      branchEnvironmentMode !== "local" &&
      branchEnvironmentMode !== "worktree"
    ) {
      return [];
    }
    const branches = activeBranchesQuery.data?.remoteBranches ?? [];
    const selectedRef = activeBranchesQuery.data?.selectedBranch;
    return selectedRef?.kind === "remote" &&
      !branches.includes(selectedRef.name)
      ? [selectedRef.name, ...branches]
      : branches;
  }, [
    activeBranchesQuery.data?.remoteBranches,
    activeBranchesQuery.data?.selectedBranch,
    branchEnvironmentMode,
  ]);
  const branchOptionsTruncated = Boolean(
    activeBranchesQuery.data?.branchesTruncated ||
    ((branchEnvironmentMode === "local" ||
      branchEnvironmentMode === "worktree") &&
      activeBranchesQuery.data?.remoteBranchesTruncated),
  );
  const branchSelectionSeed =
    branchEnvironmentMode === "local" &&
    activeBranchesQuery.data?.checkout.kind === "branch"
      ? activeBranchesQuery.data.checkout.branchName
      : branchEnvironmentMode === "worktree"
        ? (activeBranchesQuery.data?.defaultBranch ?? null)
        : null;
  const handleCreateBranchFromSeed = useCallback(() => {
    handleCreateBranch(branchSelectionSeed);
  }, [branchSelectionSeed, handleCreateBranch]);
  const branchUiState = useMemo(
    () =>
      buildProjectMainBranchUiState({
        checkout: activeBranchesQuery.data,
        isFetching: activeBranchesQuery.isFetching,
        isLoading: activeBranchesQuery.isLoading,
        mode: branchEnvironmentMode,
        selectedBranch,
      }),
    [
      activeBranchesQuery.data,
      activeBranchesQuery.isFetching,
      activeBranchesQuery.isLoading,
      branchEnvironmentMode,
      selectedBranch,
    ],
  );
  const refetchSourceBranches = activeBranchesQuery.refetch;
  const handleBranchOpenChange = useCallback(
    (open: boolean) => {
      if (open) {
        void refetchSourceBranches();
      }
    },
    [refetchSourceBranches],
  );

  const selectedEnvironment = useMemo(
    () =>
      resolveProjectMainThreadEnvironment({
        environmentValue: effectiveEnvironmentValue,
        projectId,
        selectedBranch,
      }),
    [effectiveEnvironmentValue, projectId, selectedBranch],
  );

  const projectOptions = useMemo(
    (): readonly ProjectSelectorOption[] =>
      projects?.map((project) => ({ id: project.id, name: project.name })) ??
      [],
    [projects],
  );

  const selectedThreadModel = activeModel?.model ?? selectedModel;
  const handleProjectChange = useCallback(
    (nextProjectId: string) => {
      if (nextProjectId === projectId) return;
      navigate(`/projects/${nextProjectId}`);
    },
    [navigate, projectId],
  );

  const shouldFocusPrompt =
    typeof location.state === "object" &&
    location.state !== null &&
    "focusPrompt" in location.state &&
    location.state.focusPrompt === true;

  useEffect(() => {
    if (!shouldFocusPrompt) return;
    const handle = window.requestAnimationFrame(() => {
      const promptEl = document.getElementById("project-main-prompt");
      if (!(promptEl instanceof HTMLTextAreaElement)) return;
      promptEl.focus();
      const caretIndex = promptEl.value.length;
      promptEl.setSelectionRange(caretIndex, caretIndex);
    });
    return () => window.cancelAnimationFrame(handle);
  }, [location.key, shouldFocusPrompt]);

  const handleAttachFiles = useCallback(
    async (files: File[]) => {
      if (!projectId || files.length === 0) return;

      setAttachmentError(null);
      for (const file of files) {
        try {
          const uploaded = await uploadPromptAttachment.mutateAsync({
            projectId,
            file,
          });
          promptDraft.addAttachment(uploaded);
        } catch (err) {
          setAttachmentError(
            getMutationErrorMessage({
              error: err,
              fallbackMessage: "Attachment upload failed",
            }),
          );
          break;
        }
      }
    },
    [projectId, promptDraft, uploadPromptAttachment],
  );

  const submitPrompt = useCallback(async () => {
    const submittedDraft = {
      text: promptDraft.text,
      attachments: promptDraft.attachments,
    };
    const submittedInput = promptDraftToInput(submittedDraft);
    if (!projectId || !selectedProviderId || !selectedThreadModel) {
      return;
    }

    setAttachmentError(null);

    if (mode === "manager") {
      // Managers don't require a prompt — submitting with empty text just
      // falls back to the server's welcome-message template. Host comes
      // from the manager-mode host picker; template comes from the
      // template picker (only sent when non-empty so the server keeps its
      // own default).
      if (hireProjectManager.isPending || !effectiveManagerHostId) return;
      try {
        await hireProjectManager.mutateAsync({
          projectId,
          providerId: selectedProviderId,
          model: selectedThreadModel,
          reasoningLevel,
          environment: { type: "host", hostId: effectiveManagerHostId },
          ...(effectiveManagerTemplateName
            ? { templateName: effectiveManagerTemplateName }
            : {}),
          ...(submittedInput.length > 0 ? { input: submittedInput } : {}),
        });
        promptDraft.clearIfCurrentMatches(submittedDraft);
      } catch {
        // Global mutation error handling already surfaced the failure.
      }
      return;
    }

    if (
      submittedInput.length === 0 ||
      createThread.isPending ||
      !selectedEnvironment
    ) {
      return;
    }

    try {
      await createThread.mutateAsync({
        input: submittedInput,
        projectId,
        providerId: selectedProviderId,
        model: selectedThreadModel,
        ...(supportsServiceTier && serviceTier ? { serviceTier } : {}),
        reasoningLevel,
        permissionMode,
        environment: selectedEnvironment,
      });
      promptDraft.clearIfCurrentMatches(submittedDraft);
    } catch {
      // Global mutation error handling already surfaced the failure.
    }
  }, [
    createThread,
    effectiveManagerHostId,
    effectiveManagerTemplateName,
    hireProjectManager,
    mode,
    permissionMode,
    projectId,
    promptDraft,
    reasoningLevel,
    selectedEnvironment,
    selectedProviderId,
    selectedThreadModel,
    serviceTier,
    supportsServiceTier,
  ]);

  // Manager-mode submission relaxes the prompt-required and env-resolution
  // checks (managers don't take a prompt or a worktree-shaped env). Both
  // modes still require provider + model and a project; manager mode also
  // needs an eligible host resolved.
  const isSubmitDisabled =
    !selectedProviderId ||
    !selectedThreadModel ||
    (mode === "manager"
      ? hireProjectManager.isPending || !effectiveManagerHostId
      : createThread.isPending ||
        promptInput.length === 0 ||
        !selectedEnvironment ||
        (branchEnvironmentMode === "local" &&
          selectedBranch !== null &&
          branchUiState.mutationBlocker !== null));

  const currentPromptDraft = useMemo(
    () => ({
      text: promptDraft.text,
      attachments: promptDraft.attachments,
    }),
    [promptDraft.attachments, promptDraft.text],
  );
  const historyConfig = useMemo(
    () => ({
      currentDraft: currentPromptDraft,
      entries: promptHistoryDrafts,
      onSelectEntry: promptDraft.setDraft,
      resetKey: projectId,
    }),
    [currentPromptDraft, projectId, promptDraft.setDraft, promptHistoryDrafts],
  );
  const mentionsConfig = useMemo(
    () => ({
      suggestions: promptMentions.suggestions,
      threadSectionMode: promptMentions.threadSectionMode,
      isLoading: promptMentions.isLoading,
      isError: promptMentions.isError,
      onQueryChange: promptMentions.setQuery,
    }),
    [
      promptMentions.isError,
      promptMentions.isLoading,
      promptMentions.setQuery,
      promptMentions.suggestions,
      promptMentions.threadSectionMode,
    ],
  );
  const attachmentsConfig = useMemo(
    () => ({
      items: promptDraft.attachments,
      projectId: projectId ?? "",
      onAttachFiles: handleAttachFiles,
      onRemove: promptDraft.removeAttachment,
      isAttaching: uploadPromptAttachment.isPending,
      error: attachmentError,
    }),
    [
      attachmentError,
      handleAttachFiles,
      projectId,
      promptDraft.attachments,
      promptDraft.removeAttachment,
      uploadPromptAttachment.isPending,
    ],
  );
  const executionConfig = useMemo(
    () => ({
      provider: {
        options: providerOptions,
        selectedId: selectedProviderId,
        onChange: setSelectedProviderId,
        hasMultiple: hasMultipleProviders,
      },
      model: {
        active: activeModel,
        selected: selectedModel,
        options: modelOptions,
        loadError: modelLoadError,
        onChange: setSelectedModel,
      },
      serviceTier: {
        value: serviceTier,
        onChange: setServiceTier,
        supported: supportsServiceTier,
        supportByProvider: serviceTierSupportByProvider,
      },
      reasoning: {
        value: reasoningLevel,
        options: reasoningOptions,
        onChange: setReasoningLevel,
      },
    }),
    [
      activeModel,
      hasMultipleProviders,
      modelLoadError,
      modelOptions,
      providerOptions,
      reasoningLevel,
      reasoningOptions,
      selectedModel,
      selectedProviderId,
      serviceTier,
      serviceTierSupportByProvider,
      setReasoningLevel,
      setSelectedModel,
      setSelectedProviderId,
      setServiceTier,
      supportsServiceTier,
    ],
  );
  const environmentConfig = useMemo(
    () => ({
      value: effectiveEnvironmentValue,
      onChange: setEnvironmentSelectionValue,
      sources: projectSources,
      personalWorkspace: false,
      reuseDisabled: reuseThreadOptions.length === 0,
    }),
    [
      effectiveEnvironmentValue,
      projectSources,
      reuseThreadOptions.length,
      setEnvironmentSelectionValue,
    ],
  );
  const worktreeConfig = useMemo(() => {
    const handleWorktreeChange = (environmentId: string) => {
      setEnvironmentSelectionValue(encodeReuseValue(environmentId));
    };
    return {
      options: reuseThreadOptions,
      value:
        parsedEnvironment?.type === "reuse"
          ? parsedEnvironment.environmentId
          : null,
      onChange: handleWorktreeChange,
    };
  }, [parsedEnvironment, reuseThreadOptions, setEnvironmentSelectionValue]);
  const branchConfig = useMemo(
    () => ({
      value:
        selectedBranch?.name ??
        (branchEnvironmentMode === "worktree"
          ? branchUiState.currentBranch
          : null),
      currentBranch: branchUiState.currentBranch,
      isNew: selectedBranch?.isNew ?? false,
      options: branchOptions,
      remoteOptions: remoteBranchOptions,
      optionsTruncated: branchOptionsTruncated,
      loading: activeBranchesQuery.isFetching,
      placeholder: branchUiState.placeholder,
      triggerLabel: branchUiState.triggerLabel,
      triggerTitle: branchUiState.triggerTitle,
      currentOptionLabel:
        branchEnvironmentMode === "local"
          ? branchUiState.currentOptionLabel
          : null,
      currentOptionTitle:
        branchEnvironmentMode === "local"
          ? (branchUiState.currentOptionLabel ?? undefined)
          : undefined,
      optionDisabledReason: branchUiState.mutationBlocker?.label,
      optionDisabledTitle: branchUiState.mutationBlocker?.title,
      createDisabledReason: branchUiState.mutationBlocker?.label,
      createDisabledTitle: branchUiState.mutationBlocker?.title,
      onChange: handleBranchChange,
      onClear: handleClearBranch,
      onCreate: handleCreateBranchFromSeed,
      onCreateBaseChange: handleCreateBranchFrom,
      onOpenChange: handleBranchOpenChange,
      onSearchQueryChange: setBranchSearchQuery,
    }),
    [
      activeBranchesQuery.isFetching,
      branchOptionsTruncated,
      branchOptions,
      branchEnvironmentMode,
      remoteBranchOptions,
      branchUiState.currentBranch,
      branchUiState.currentOptionLabel,
      branchUiState.mutationBlocker,
      branchUiState.placeholder,
      branchUiState.triggerLabel,
      branchUiState.triggerTitle,
      handleBranchChange,
      handleBranchOpenChange,
      handleClearBranch,
      handleCreateBranchFromSeed,
      handleCreateBranchFrom,
      setBranchSearchQuery,
      selectedBranch?.isNew,
      selectedBranch?.name,
    ],
  );
  const permissionConfig = useMemo(
    () => ({
      value: permissionMode,
      options: permissionModeOptions,
      onChange: setPermissionMode,
      supported: supportsPermissionModeSelection,
    }),
    [
      permissionMode,
      permissionModeOptions,
      setPermissionMode,
      supportsPermissionModeSelection,
    ],
  );

  const reuseHeader = useMemo(() => {
    if (parsedEnvironment?.type !== "reuse") return null;
    return (
      <div className="flex">
        {/* `-ml-1.5` shifts the pill 6px left so its GitBranch icon column
            lines up with the mode-selector icon above the card (mode
            selector has `px-1` on its trigger; the pill has `px-2.5`). */}
        <button
          type="button"
          onClick={clearReuseEnvironment}
          title="Stop reusing and start a regular new thread"
          aria-label="Stop reusing worktree"
          className="group -ml-1.5 inline-flex h-7 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          <span className="relative inline-flex size-3.5 shrink-0 items-center justify-center">
            <Icon
              name="GitBranch"
              className="size-3.5 transition-opacity group-hover:opacity-0"
              aria-hidden
            />
            <Icon
              name="X"
              className="absolute size-3.5 opacity-0 transition-opacity group-hover:opacity-100"
              aria-hidden
            />
          </span>
          Reusing existing worktree
        </button>
      </div>
    );
  }, [clearReuseEnvironment, parsedEnvironment]);

  // Match ThreadDetailView's invalid-id pattern: distinguish missing param,
  // loading, and not-found/error so the page never renders against a project
  // the user can't see in the list. The selector inside the page therefore
  // can rely on projectId existing in projectOptions — no synthetic
  // placeholder, no surfacing the raw id to the user.
  if (!projectId) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Select a project.
        </p>
      </PageShell>
    );
  }
  if (!hasSidebarBootstrapSettled) {
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-muted-foreground">
          Loading…
        </p>
      </PageShell>
    );
  }
  if (!projects?.some((project) => project.id === projectId)) {
    const errored = sidebarBootstrapQuery.isError || projectsQuery.isError;
    return (
      <PageShell contentClassName="min-h-full items-center justify-center">
        <p className="py-12 text-center text-sm text-destructive">
          {errored ? "Failed to load projects." : "Project not found"}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell contentClassName="pt-4 md:pt-5">
      <NewThreadPromptBox
        id="project-main-prompt"
        value={prompt}
        onChange={promptDraft.setText}
        onSubmit={submitPrompt}
        isSubmitting={
          mode === "manager"
            ? hireProjectManager.isPending
            : createThread.isPending
        }
        disabled={isSubmitDisabled}
        zenModeStorageKey={projectMainZenModeStorageKey}
        history={historyConfig}
        mentions={mentionsConfig}
        attachments={attachmentsConfig}
        modeConfig={
          mode === "manager"
            ? {
                mode: "manager",
                host: {
                  hosts,
                  eligibleHosts: eligibleManagerHosts,
                  value: effectiveManagerHostId,
                  onChange: setManagerHostSelection,
                  isLocalHost,
                },
                ...(managerTemplates.length > 0
                  ? {
                      template: {
                        templates: managerTemplates,
                        value: effectiveManagerTemplateName,
                        onChange: setManagerTemplateSelection,
                      },
                    }
                  : {}),
              }
            : {
                mode: "thread",
                environment: environmentConfig,
                branch: branchConfig,
                worktree: worktreeConfig,
                permission: permissionConfig,
                header: reuseHeader,
              }
        }
        onModeChange={setMode}
        // Project picker is rendered INSIDE the prompt box's strip below
        // the card. Switching projects routes through the same handler
        // (navigate to /projects/:id).
        project={{
          projects: projectOptions,
          value: projectId ?? null,
          onChange: (id) => {
            if (id !== null) handleProjectChange(id);
          },
        }}
        execution={executionConfig}
      />
    </PageShell>
  );
}
