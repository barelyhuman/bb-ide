import { useMemo } from "react";
import type { ThreadType } from "@bb/domain";
import {
  usePathSuggestions,
  type PathSuggestion,
  type PathSuggestionSource,
} from "./usePathSuggestions";

const DEFAULT_FILE_SEARCH_SUGGESTION_LIMIT = 8;

export interface FileSearchSuggestion {
  source: PathSuggestionSource;
  entryKind: "file";
  path: string;
  name: string;
  score: number;
  positions: number[];
}

export interface UseFileSearchSuggestionsArgs {
  projectId: string | undefined;
  query: string | null;
  limit?: number;
  environmentId: string | null;
  currentThreadId?: string;
  currentThreadType?: ThreadType;
}

export interface UseFileSearchSuggestionsResult {
  suggestions: FileSearchSuggestion[];
  isLoading: boolean;
  isError: boolean;
  isDebouncing: boolean;
  isUnavailable: boolean;
}

interface FilePathSuggestion extends PathSuggestion {
  entryKind: "file";
}

function isFilePathSuggestion(
  suggestion: PathSuggestion,
): suggestion is FilePathSuggestion {
  return suggestion.entryKind === "file";
}

function toFileSearchSuggestion(
  suggestion: FilePathSuggestion,
): FileSearchSuggestion {
  return {
    source: suggestion.source,
    entryKind: "file",
    path: suggestion.path,
    name: suggestion.name,
    score: suggestion.score,
    positions: suggestion.positions,
  };
}

export function useFileSearchSuggestions(
  args: UseFileSearchSuggestionsArgs,
): UseFileSearchSuggestionsResult {
  const limit = args.limit ?? DEFAULT_FILE_SEARCH_SUGGESTION_LIMIT;
  const pathSuggestions = usePathSuggestions({
    projectId: args.projectId,
    query: args.query,
    limit,
    environmentId: args.environmentId,
    currentThreadId: args.currentThreadId,
    currentThreadType: args.currentThreadType,
    includeDirectories: false,
  });
  const suggestions = useMemo<FileSearchSuggestion[]>(
    () =>
      pathSuggestions.suggestions
        .filter(isFilePathSuggestion)
        .map(toFileSearchSuggestion),
    [pathSuggestions.suggestions],
  );
  const canSearchWorkspace = Boolean(args.projectId);
  const canSearchThreadStorage =
    args.currentThreadType === "manager" && Boolean(args.currentThreadId);

  return {
    suggestions,
    isLoading: pathSuggestions.isLoading,
    isError: pathSuggestions.isError,
    isDebouncing: pathSuggestions.isDebouncing,
    isUnavailable: !canSearchWorkspace && !canSearchThreadStorage,
  };
}
