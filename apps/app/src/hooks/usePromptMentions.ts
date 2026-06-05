import { useMemo, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { ThreadType } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { buildPathMentionSuggestions } from "./pathMentionSuggestions";
import { useSidebarNavigation } from "./queries/project-queries";
import { useThreadMentionCandidates } from "./queries/thread-queries";
import {
  buildThreadMentionSuggestions,
  type ThreadSuggestionMode,
} from "./threadMentionSuggestions";
import { usePathSuggestions } from "./usePathSuggestions";
import type { PromptMentionSuggestion } from "@/components/promptbox/mentions/types";

const PROMPT_MENTION_LIMIT = 8;

export interface UsePromptMentionsOptions {
  threadSuggestionMode?: ThreadSuggestionMode;
  currentThreadId?: string;
  currentThreadType?: ThreadType;
  environmentId: string | null;
}

export interface UsePromptMentionsResult {
  query: string | null;
  setQuery: Dispatch<SetStateAction<string | null>>;
  suggestions: PromptMentionSuggestion[];
  isLoading: boolean;
  isError: boolean;
}

interface BuildPromptMentionSuggestionsArgs {
  pathSuggestions: readonly PromptMentionSuggestion[];
  threadSuggestions: readonly PromptMentionSuggestion[];
  trimmedQuery: string;
}

function buildPromptMentionSuggestions(
  args: BuildPromptMentionSuggestionsArgs,
): PromptMentionSuggestion[] {
  const orderedSuggestions = args.trimmedQuery.includes("/")
    ? [...args.pathSuggestions, ...args.threadSuggestions]
    : [...args.threadSuggestions, ...args.pathSuggestions];

  return orderedSuggestions.slice(0, PROMPT_MENTION_LIMIT);
}

function buildProjectNamesById(
  sidebarNavigation: SidebarBootstrapResponse | undefined,
): ReadonlyMap<string, string> {
  const projectNamesById = new Map<string, string>();
  if (!sidebarNavigation) {
    return projectNamesById;
  }

  projectNamesById.set(
    sidebarNavigation.personalProject.id,
    sidebarNavigation.personalProject.name,
  );
  for (const project of sidebarNavigation.projects) {
    projectNamesById.set(project.id, project.name);
  }
  return projectNamesById;
}

export function usePromptMentions(
  projectId: string | undefined,
  options: UsePromptMentionsOptions,
): UsePromptMentionsResult {
  const [query, setQuery] = useState<string | null>(null);
  const hasQuery = (query?.trim().length ?? 0) > 0;
  const trimmedQuery = query?.trim() ?? "";

  const pathSearch = usePathSuggestions({
    projectId,
    query,
    limit: PROMPT_MENTION_LIMIT,
    environmentId: options.environmentId,
    currentThreadId: options.currentThreadId,
    currentThreadType: options.currentThreadType,
    includeDirectories: true,
  });
  const threadSuggestionMode = options.threadSuggestionMode ?? "none";
  const projectNamesQuery = useSidebarNavigation({
    enabled: threadSuggestionMode === "all" && hasQuery,
  });
  const threadsQuery = useThreadMentionCandidates({
    enabled: threadSuggestionMode === "all" && hasQuery,
  });
  const projectNamesById = useMemo(
    () => buildProjectNamesById(projectNamesQuery.data),
    [projectNamesQuery.data],
  );

  const currentThreadId = options.currentThreadId;
  const pathSuggestions = useMemo(
    () =>
      buildPathMentionSuggestions({
        paths: pathSearch.suggestions,
      }),
    [pathSearch.suggestions],
  );
  const threadSuggestions = useMemo(() => {
    return buildThreadMentionSuggestions({
      threads: threadsQuery.data ?? [],
      query: trimmedQuery,
      mode: threadSuggestionMode,
      currentProjectId: projectId,
      currentThreadId,
      projectNamesById,
      limit: PROMPT_MENTION_LIMIT,
    });
  }, [
    currentThreadId,
    projectId,
    projectNamesById,
    threadSuggestionMode,
    threadsQuery.data,
    trimmedQuery,
  ]);
  const suggestions = useMemo(
    () =>
      hasQuery
        ? buildPromptMentionSuggestions({
            pathSuggestions,
            threadSuggestions,
            trimmedQuery,
          })
        : [],
    [hasQuery, pathSuggestions, threadSuggestions, trimmedQuery],
  );

  // Loading flips on only when there are zero suggestions to show. Once the
  // first fetch returns (or placeholderData carries prior results across a
  // refetch), suggestions stay populated and the menu never collapses back
  // to the loading state mid-typing.
  const isLoading =
    hasQuery &&
    suggestions.length === 0 &&
    (pathSearch.isDebouncing ||
      pathSearch.isLoading ||
      threadsQuery.isLoading ||
      threadsQuery.isFetching);
  const isError = pathSearch.isError || threadsQuery.isError;

  return {
    query,
    setQuery,
    suggestions,
    isLoading,
    isError,
  };
}
