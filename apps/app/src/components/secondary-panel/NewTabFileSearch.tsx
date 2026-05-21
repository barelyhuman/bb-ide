import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import type { ThreadType } from "@bb/domain";
import { Icon } from "@/components/ui/icon.js";
import { Input } from "@/components/ui/input.js";
import { TruncateStart } from "@/components/ui/truncate-start.js";
import {
  useFileSearchSuggestions,
  type FileSearchSuggestion,
} from "@/hooks/useFileSearchSuggestions";
import type { FileSearchSelection } from "./useThreadFileTabs";
import { cn } from "@/lib/utils";

export interface NewTabFileSearchProps {
  projectId: string | undefined;
  environmentId: string | null;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
  focusRequest: number;
  initialQuery?: string;
  onSelect: (selection: FileSearchSelection) => void;
}

interface FileSearchResultRowProps {
  id: string;
  suggestion: FileSearchSuggestion;
  isActive: boolean;
  onActivate: () => void;
  onSelect: (suggestion: FileSearchSuggestion) => void;
}

interface FileSearchMessageProps {
  iconName: "AlertCircle" | "File" | "FileQuestion" | "Spinner";
  iconClassName?: string;
  message: string;
}

interface FileSearchSectionItem {
  suggestion: FileSearchSuggestion;
  index: number;
}

interface FileSearchSection {
  source: FileSearchSource;
  label: string;
  items: FileSearchSectionItem[];
}

interface SplitPathResult {
  name: string;
  directory: string;
}

type SearchInputKeyDownHandler = (
  event: KeyboardEvent<HTMLInputElement>,
) => void;
type FileSearchSource = FileSearchSuggestion["source"];

interface GetAvailableFileSearchSourcesArgs {
  projectId: string | undefined;
  currentThreadId: string;
  currentThreadType: ThreadType | undefined;
}

interface GroupFileSearchSectionsArgs {
  suggestions: readonly FileSearchSuggestion[];
  availableSources: readonly FileSearchSource[];
}

const FILE_SEARCH_LIMIT = 20;
const FILE_SEARCH_SECTION_ORDER: readonly FileSearchSource[] = [
  "workspace",
  "thread-storage",
];

const FILE_SEARCH_SECTION_LABELS = {
  workspace: "Workspace",
  "thread-storage": "Manager Storage",
} satisfies Record<FileSearchSource, string>;

function getAvailableFileSearchSources({
  projectId,
  currentThreadId,
  currentThreadType,
}: GetAvailableFileSearchSourcesArgs): readonly FileSearchSource[] {
  const sources: FileSearchSource[] = [];
  if (projectId) {
    sources.push("workspace");
  }
  if (currentThreadType === "manager" && currentThreadId.length > 0) {
    sources.push("thread-storage");
  }
  return sources;
}

function getFileSearchResultId(suggestion: FileSearchSuggestion): string {
  return `file-search-result-${suggestion.source}-${encodeURIComponent(
    suggestion.path,
  )}`;
}

function splitPath(path: string): SplitPathResult {
  const lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) {
    return { name: path, directory: "" };
  }
  return {
    name: path.slice(lastSlash + 1),
    directory: path.slice(0, lastSlash),
  };
}

function getFileSearchResultTitle(suggestion: FileSearchSuggestion): string {
  return `${FILE_SEARCH_SECTION_LABELS[suggestion.source]}: ${suggestion.path}`;
}

function groupFileSearchSections({
  availableSources,
  suggestions,
}: GroupFileSearchSectionsArgs): FileSearchSection[] {
  const allowedSources = new Set<FileSearchSource>(availableSources);
  const sectionsBySource = new Map<FileSearchSource, FileSearchSection>();

  for (const suggestion of suggestions) {
    const source = suggestion.source;
    if (!allowedSources.has(source)) {
      continue;
    }
    const existing = sectionsBySource.get(source);
    if (existing) {
      existing.items.push({
        suggestion,
        index: existing.items.length,
      });
      continue;
    }

    sectionsBySource.set(source, {
      source,
      label: FILE_SEARCH_SECTION_LABELS[source],
      items: [{ suggestion, index: 0 }],
    });
  }

  let nextIndex = 0;
  return FILE_SEARCH_SECTION_ORDER.flatMap((source) => {
    const section = sectionsBySource.get(source);
    if (!section) {
      return [];
    }
    return [
      {
        ...section,
        items: section.items.map(({ suggestion }) => {
          const index = nextIndex;
          nextIndex += 1;
          return { suggestion, index };
        }),
      },
    ];
  });
}

function FileSearchMessage({
  iconName,
  iconClassName,
  message,
}: FileSearchMessageProps) {
  return (
    <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed border-border bg-surface-raised px-3 py-6 text-center text-sm text-muted-foreground">
      <div className="flex max-w-64 flex-col items-center gap-2">
        <Icon name={iconName} className={cn("size-4", iconClassName)} />
        <p>{message}</p>
      </div>
    </div>
  );
}

function FileSearchResultRow({
  id,
  suggestion,
  isActive,
  onActivate,
  onSelect,
}: FileSearchResultRowProps) {
  const { directory } = splitPath(suggestion.path);
  const secondaryDirectory = directory || null;
  const handleSelect = useCallback(() => {
    onSelect(suggestion);
  }, [onSelect, suggestion]);

  return (
    <button
      type="button"
      id={id}
      role="option"
      aria-selected={isActive}
      onClick={handleSelect}
      onMouseEnter={onActivate}
      title={getFileSearchResultTitle(suggestion)}
      className={cn(
        "w-full scroll-mt-7 rounded px-2 py-1.5 text-left text-xs transition-colors",
        isActive ? "bg-state-active" : "hover:bg-state-hover",
      )}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <Icon
          name="File"
          className="size-3.5 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="truncate">{suggestion.name}</span>
        {secondaryDirectory !== null ? (
          <TruncateStart className="text-muted-foreground [flex-shrink:9999]">
            {secondaryDirectory}
          </TruncateStart>
        ) : null}
      </div>
    </button>
  );
}

export function NewTabFileSearch({
  projectId,
  environmentId,
  currentThreadId,
  currentThreadType,
  focusRequest,
  initialQuery = "",
  onSelect,
}: NewTabFileSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [activeIndex, setActiveIndex] = useState(-1);
  const trimmedQuery = query.trim();
  const hasQuery = trimmedQuery.length > 0;
  const { suggestions, isLoading, isError, isDebouncing, isUnavailable } =
    useFileSearchSuggestions({
      projectId,
      query,
      limit: FILE_SEARCH_LIMIT,
      environmentId,
      currentThreadId,
      currentThreadType,
    });
  const availableSources = useMemo(
    () =>
      getAvailableFileSearchSources({
        projectId,
        currentThreadId,
        currentThreadType,
      }),
    [currentThreadId, currentThreadType, projectId],
  );
  const sections = useMemo(
    () => groupFileSearchSections({ availableSources, suggestions }),
    [availableSources, suggestions],
  );
  const visualSuggestions = useMemo(
    () =>
      sections.flatMap((section) =>
        section.items.map(({ suggestion }) => suggestion),
      ),
    [sections],
  );
  const activeSuggestion = useMemo(
    () =>
      activeIndex >= 0 && activeIndex < visualSuggestions.length
        ? (visualSuggestions[activeIndex] ?? null)
        : null,
    [activeIndex, visualSuggestions],
  );

  useEffect(() => {
    // Focus synchronously, then again on the next frame to win the focus race
    // against the panel/tab content mounting in the same commit, which can
    // otherwise pull focus away from the input.
    inputRef.current?.focus();
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [focusRequest]);

  useEffect(() => {
    setActiveIndex(visualSuggestions.length > 0 ? 0 : -1);
  }, [visualSuggestions]);

  const handleSuggestionSelect = useCallback(
    (suggestion: FileSearchSuggestion) => {
      onSelect({
        source: suggestion.source,
        path: suggestion.path,
      });
    },
    [onSelect],
  );

  const handleInputKeyDown = useCallback<SearchInputKeyDownHandler>(
    (event) => {
      if (visualSuggestions.length === 0) {
        return;
      }

      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActiveIndex((current) => (current + 1) % visualSuggestions.length);
        return;
      }

      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActiveIndex((current) =>
          current <= 0 ? visualSuggestions.length - 1 : current - 1,
        );
        return;
      }

      if (event.key === "Enter" && activeSuggestion) {
        event.preventDefault();
        handleSuggestionSelect(activeSuggestion);
      }
    },
    [activeSuggestion, handleSuggestionSelect, visualSuggestions.length],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleInputKeyDown}
          disabled={isUnavailable}
          aria-label="Search files"
          aria-activedescendant={
            activeSuggestion ? getFileSearchResultId(activeSuggestion) : undefined
          }
          placeholder={isUnavailable ? "No searchable source" : "Search files"}
          className="h-8 pl-8 pr-8 text-xs focus-visible:ring-0"
        />
        {isDebouncing ? (
          <Icon
            name="Spinner"
            className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
          />
        ) : null}
      </div>

      {isUnavailable ? (
        <FileSearchMessage
          iconName="FileQuestion"
          message="No searchable file source is available."
        />
      ) : isError ? (
        <FileSearchMessage
          iconName="AlertCircle"
          message="File search failed."
        />
      ) : isLoading ? (
        <FileSearchMessage
          iconName="Spinner"
          iconClassName="animate-spin"
          message="Searching files..."
        />
      ) : sections.length > 0 ? (
        <div
          role="listbox"
          aria-label="File search results"
          className="min-h-0 flex-1 overflow-y-auto pb-1"
        >
          {sections.map((section, sectionIndex) => (
            <div
              key={section.source}
              className={cn(sectionIndex > 0 && "mt-2")}
            >
              <div
                className={cn(
                  "sticky top-0 z-10 bg-background px-2 pb-1 text-xs text-muted-foreground",
                  sectionIndex === 0 ? "pt-0" : "pt-1.5",
                )}
              >
                {section.label}
              </div>
              <div className="flex flex-col gap-px">
                {section.items.map(({ suggestion, index }) => (
                  <FileSearchResultRow
                    key={`${suggestion.source}:${suggestion.path}`}
                    id={getFileSearchResultId(suggestion)}
                    suggestion={suggestion}
                    isActive={index === activeIndex}
                    onActivate={() => setActiveIndex(index)}
                    onSelect={handleSuggestionSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <FileSearchMessage
          iconName={hasQuery ? "FileQuestion" : "File"}
          message={hasQuery ? "No files match." : "Type to search files."}
        />
      )}
    </div>
  );
}
