import { useEffect, useState } from "react";
import { useProjectFileSuggestions } from "./useApi";

const FILE_MENTION_DEBOUNCE_MS = 120;
const FILE_MENTION_LIMIT = 8;

export function usePromptFileMentions(projectId: string | undefined) {
  const [query, setQuery] = useState<string | null>(null);
  const [debouncedQuery, setDebouncedQuery] = useState<string | null>(null);

  useEffect(() => {
    if (query === null) {
      setDebouncedQuery(null);
      return;
    }

    const timeout = window.setTimeout(() => {
      setDebouncedQuery(query);
    }, FILE_MENTION_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [query]);

  const search = useProjectFileSuggestions(
    projectId,
    debouncedQuery,
    FILE_MENTION_LIMIT,
  );

  const hasQuery = (query?.trim().length ?? 0) > 0;

  return {
    query,
    setQuery,
    suggestions: search.data ?? [],
    isLoading: hasQuery && (search.isPending || search.isFetching),
    isError: search.isError,
  };
}
