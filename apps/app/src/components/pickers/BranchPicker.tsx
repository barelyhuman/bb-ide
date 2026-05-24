import {
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { Button } from "@/components/ui/button.js";
import { Icon, type IconName } from "@/components/ui/icon.js";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_SHRINK_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { Input } from "@/components/ui/input.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover.js";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_CONTENT_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
} from "./OptionPicker";
import { cn } from "@/lib/utils";

interface GetMergeBaseBranchCandidatesArgs {
  mergeBaseBranch?: string;
  mergeBaseBranchOptions?: readonly string[];
}

export function getMergeBaseBranchCandidates({
  mergeBaseBranch,
  mergeBaseBranchOptions,
}: GetMergeBaseBranchCandidatesArgs) {
  const fromProps = mergeBaseBranchOptions ?? [];
  if (!mergeBaseBranch || fromProps.includes(mergeBaseBranch)) {
    return fromProps;
  }
  return [mergeBaseBranch, ...fromProps];
}

const CREATE_NEW_BRANCH_LABEL = "New branch";
const BRANCH_LABEL_PREFIXES = [
  "Start from:",
  "Current:",
  "Checkout:",
  "Branch from:",
] as const;
const CURRENT_PARENTHESES_LABEL_PREFIX = "Current (";
const DETACHED_LABEL_PREFIX = "Detached";
// Match `DropdownMenuItem` / `DropdownMenuLabel` typography and density so the
// branch popover reads as the same family of menu as the other pickers
// (text-xs, px-2 py-[0.3125rem]).
const BRANCH_PICKER_ROW_CLASS_NAME =
  "flex w-full min-w-0 items-center gap-2 rounded-sm px-2 py-[0.3125rem] text-left text-xs outline-none transition-colors hover:bg-state-hover hover:text-foreground focus-visible:bg-state-hover focus-visible:text-foreground";
const BRANCH_PICKER_HEADER_CLASS_NAME =
  "px-2 py-[0.3125rem] text-xs font-medium text-muted-foreground";

interface BranchPlainLabelParts {
  kind: "plain";
  value: string;
}

interface BranchPrefixedLabelParts {
  kind: "prefixed";
  prefix: string;
  value: string;
}

interface BranchParentheticalLabelParts {
  kind: "parenthetical";
  prefix: string;
  value: string;
}

type BranchLabelParts =
  | BranchPlainLabelParts
  | BranchPrefixedLabelParts
  | BranchParentheticalLabelParts;

interface BranchPickerTextProps {
  label: string;
  isCreatingNew: boolean;
  emphasizePlainLabel?: boolean;
  className?: string;
}

interface BranchPickerSectionHeaderProps {
  label: string;
  subtitle?: string;
  subtitleTitle?: string;
  className?: string;
}

export type BranchPickerMenuKind = "checkout" | "base";

interface BranchPickerMenuCopy {
  title: string | null;
  currentSectionLabel: string | null;
  optionsSectionLabel: string | null;
  optionsUnavailableFallback: string;
}

const GENERIC_BRANCH_MENU_COPY: BranchPickerMenuCopy = {
  title: null,
  currentSectionLabel: "Current",
  optionsSectionLabel: "Branches",
  optionsUnavailableFallback: "Branch selection is unavailable right now.",
};

const CHECKOUT_BRANCH_MENU_COPY: BranchPickerMenuCopy = {
  title: "Start from:",
  currentSectionLabel: null,
  optionsSectionLabel: "Checkout:",
  optionsUnavailableFallback: "Branch checkout is unavailable right now.",
};

const BASE_BRANCH_MENU_COPY: BranchPickerMenuCopy = {
  title: "Branch from:",
  currentSectionLabel: null,
  optionsSectionLabel: null,
  optionsUnavailableFallback: "Base branch selection is unavailable right now.",
};

interface BranchPickerUnavailableRowProps {
  icon: IconName;
  label: string;
  description: string;
  title?: string;
}

interface BranchPickerRowButtonProps {
  icon: IconName;
  label: string;
  title?: string;
  selected: boolean;
  isCreatingNew?: boolean;
  emphasizeLabel?: boolean;
  onSelect: () => void;
}

interface BranchPickerSearchProps {
  inputRef: RefObject<HTMLInputElement | null>;
  query: string;
  enterSelection: string | undefined;
  onEnterSelection: (branch: string) => void;
  onQueryChange: (query: string) => void;
}

interface FormatUnavailableDescriptionArgs {
  title?: string;
  reason?: string | null;
  fallback: string;
}

function formatUnavailableDescription({
  title,
  reason,
  fallback,
}: FormatUnavailableDescriptionArgs): string {
  return title ?? reason ?? fallback;
}

function splitBranchLabel(label: string): BranchLabelParts {
  if (
    label.startsWith(CURRENT_PARENTHESES_LABEL_PREFIX) &&
    label.endsWith(")")
  ) {
    return {
      kind: "parenthetical",
      prefix: "Current",
      value: label.slice(CURRENT_PARENTHESES_LABEL_PREFIX.length, -1),
    };
  }

  for (const prefix of BRANCH_LABEL_PREFIXES) {
    const prefixWithSpace = `${prefix} `;
    if (label.startsWith(prefixWithSpace)) {
      return {
        kind: "prefixed",
        prefix,
        value: label.slice(prefixWithSpace.length),
      };
    }
  }

  const detachedPrefixWithSpace = `${DETACHED_LABEL_PREFIX} `;
  if (label.startsWith(detachedPrefixWithSpace)) {
    return {
      kind: "prefixed",
      prefix: DETACHED_LABEL_PREFIX,
      value: label.slice(detachedPrefixWithSpace.length),
    };
  }

  return {
    kind: "plain",
    value: label,
  };
}

function BranchPickerText({
  label,
  isCreatingNew,
  emphasizePlainLabel = false,
  className,
}: BranchPickerTextProps) {
  const parts = splitBranchLabel(label);
  if (parts.kind === "plain") {
    return (
      <span
        className={cn(
          "min-w-0 truncate",
          isCreatingNew || emphasizePlainLabel
            ? "font-medium text-foreground"
            : undefined,
          className,
        )}
      >
        {parts.value}
      </span>
    );
  }

  if (parts.kind === "parenthetical") {
    return (
      <span className={cn("flex min-w-0 items-baseline", className)}>
        <span className="shrink-0 text-muted-foreground">{parts.prefix} (</span>
        <span className="min-w-0 truncate font-medium text-foreground">
          {parts.value}
        </span>
        <span className="shrink-0 text-muted-foreground">)</span>
      </span>
    );
  }

  return (
    <span className={cn("flex min-w-0 items-baseline gap-1", className)}>
      <span className="shrink-0 text-muted-foreground">{parts.prefix}</span>
      <span className="min-w-0 truncate font-medium text-foreground">
        {parts.value}
      </span>
    </span>
  );
}

function BranchPickerSectionHeader({
  label,
  subtitle,
  subtitleTitle,
  className,
}: BranchPickerSectionHeaderProps) {
  return (
    <div
      className={cn(
        BRANCH_PICKER_HEADER_CLASS_NAME,
        // Subtitle is a multi-line block underneath the label — give the
        // header a little extra bottom padding so the subtitle doesn't sit
        // flush against the row that follows.
        subtitle && "pb-1.5",
        className,
      )}
      title={subtitle ? (subtitleTitle ?? subtitle) : undefined}
    >
      <div>{label}</div>
      {subtitle ? (
        <div className="mt-1 text-xs font-normal leading-snug text-muted-foreground">
          <span className="min-w-0">{subtitle}</span>
        </div>
      ) : null}
    </div>
  );
}

function BranchPickerUnavailableRow({
  icon,
  label,
  description,
  title,
}: BranchPickerUnavailableRowProps) {
  return (
    <div
      role="note"
      title={title ?? description}
      className="flex w-full min-w-0 items-start gap-2 rounded-sm px-2 py-[0.3125rem] text-left text-xs text-muted-foreground"
    >
      <Icon
        name={icon}
        className={cn(
          "mt-0.5 text-muted-foreground",
          COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate text-foreground/80">{label}</span>
        <span className="text-xs leading-snug">{description}</span>
      </span>
    </div>
  );
}

function BranchPickerRowButton({
  icon,
  label,
  title,
  selected,
  isCreatingNew = false,
  emphasizeLabel = false,
  onSelect,
}: BranchPickerRowButtonProps) {
  return (
    <button
      type="button"
      className={BRANCH_PICKER_ROW_CLASS_NAME}
      title={title ?? label}
      onClick={onSelect}
    >
      <Icon
        name={icon}
        className={cn(
          "text-muted-foreground",
          COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
        )}
      />
      <BranchPickerText
        label={label}
        isCreatingNew={isCreatingNew}
        emphasizePlainLabel={emphasizeLabel}
        className="flex-1"
      />
      <Icon
        name="Check"
        className={
          selected
            ? cn("opacity-100", COARSE_POINTER_ICON_SIZE_SHRINK_CLASS)
            : cn("opacity-0", COARSE_POINTER_ICON_SIZE_SHRINK_CLASS)
        }
      />
    </button>
  );
}

function BranchPickerSearch({
  inputRef,
  query,
  enterSelection,
  onEnterSelection,
  onQueryChange,
}: BranchPickerSearchProps) {
  return (
    <div className="shrink-0 border-b border-border p-1.5">
      <div className="relative">
        <Icon
          name="Search"
          className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          ref={inputRef}
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") {
              return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (!enterSelection) {
              return;
            }

            onEnterSelection(enterSelection);
          }}
          placeholder="Search branches"
          className="h-8 border-0 bg-transparent pl-8 pr-2 text-xs shadow-none focus-visible:ring-0"
        />
      </div>
    </div>
  );
}

function getBranchPickerMenuCopy(
  menuKind: BranchPickerMenuKind | undefined,
): BranchPickerMenuCopy {
  switch (menuKind) {
    case "checkout":
      return CHECKOUT_BRANCH_MENU_COPY;
    case "base":
      return BASE_BRANCH_MENU_COPY;
    case undefined:
      return GENERIC_BRANCH_MENU_COPY;
  }
}

export interface BranchPickerProps {
  value: string | null;
  options: readonly string[];
  currentBranch?: string | null;
  loading?: boolean;
  disabled?: boolean;
  placeholder?: string;
  triggerLabel?: string;
  triggerTitle?: string;
  menuKind?: BranchPickerMenuKind;
  currentOptionLabel?: string | null;
  currentOptionTitle?: string;
  onChange: (branch: string) => void;
  onClear?: () => void;
  /** When provided, branch-changing choices are disabled with this reason. */
  optionDisabledReason?: string | null;
  optionDisabledTitle?: string;
  /** When provided, the create-new row is disabled with this reason. */
  createDisabledReason?: string | null;
  createDisabledTitle?: string;
  /**
   * When provided, the popover surfaces a "Create new branch" action item.
   * The server is responsible for naming the new branch — this picker only
   * captures the user's intent.
   */
  onCreate?: () => void;
  /**
   * When true, the trigger renders the create-new affordance instead of a
   * branch name. Pair with onCreate.
   */
  isCreatingNew?: boolean;
  onOpenChange?: (open: boolean) => void;
  className?: string;
  variant?: "default" | "minimal" | "option";
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. Only meaningful with variant="minimal" or "option". */
  muted?: boolean;
  /** Render with the popover open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the popover blocks page interaction. Defaults to true; pass false in stories. */
  modal?: boolean;
  /** Popover alignment relative to the trigger. Use "end" when the picker is pinned to the right edge of its container. */
  popoverAlign?: "start" | "end";
}

export function BranchPicker({
  value,
  options,
  currentBranch,
  loading = false,
  disabled,
  placeholder,
  triggerLabel: triggerLabelOverride,
  triggerTitle,
  menuKind,
  currentOptionLabel,
  currentOptionTitle,
  onChange,
  onClear,
  optionDisabledReason,
  optionDisabledTitle,
  createDisabledReason,
  createDisabledTitle,
  onCreate,
  isCreatingNew = false,
  onOpenChange,
  className,
  variant = "default",
  muted,
  defaultOpen = false,
  modal = true,
  popoverAlign = "start",
}: BranchPickerProps) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const inputRef = useRef<HTMLInputElement>(null);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const menuCopy = getBranchPickerMenuCopy(menuKind);
  const branchOptionsDisabled = Boolean(optionDisabledReason);
  const createDisabled = Boolean(createDisabledReason);
  const checkoutSectionDisabled =
    menuKind === "checkout" && (branchOptionsDisabled || createDisabled);
  const branchOptions = useMemo(
    () =>
      currentBranch
        ? options.filter((branch) => branch !== currentBranch)
        : options,
    [currentBranch, options],
  );
  const filteredOptions = useMemo(() => {
    const matches =
      normalizedQuery.length === 0
        ? branchOptions
        : branchOptions.filter((branch) =>
            branch.toLowerCase().includes(normalizedQuery),
          );
    // Pin the currently-selected branch to the top of the list so it's
    // always visible without scrolling. Only when not creating a new branch
    // (then no list option is "selected").
    if (isCreatingNew) return matches;
    if (!value) return matches;
    const selectedIndex = matches.indexOf(value);
    if (selectedIndex <= 0) return matches;
    return [
      matches[selectedIndex],
      ...matches.slice(0, selectedIndex),
      ...matches.slice(selectedIndex + 1),
    ];
  }, [branchOptions, normalizedQuery, value, isCreatingNew]);
  const enterSelection =
    branchOptionsDisabled || checkoutSectionDisabled
      ? undefined
      : value
        ? (filteredOptions.find((branch) => branch === value) ??
          filteredOptions[0])
        : filteredOptions[0];
  const unresolvedTriggerLabel = loading
    ? "Loading branches..."
    : (placeholder ?? "Select branch");
  const triggerLabel =
    triggerLabelOverride ??
    (isCreatingNew
      ? CREATE_NEW_BRANCH_LABEL
      : (value ?? unresolvedTriggerLabel));
  const triggerHasPlainBranchValue =
    !isCreatingNew && triggerLabelOverride === undefined && value !== null;
  const showCreateItem = Boolean(onCreate);
  const createDisabledDescription = formatUnavailableDescription({
    title: createDisabledTitle,
    reason: createDisabledReason,
    fallback: "New branches are unavailable right now.",
  });
  const branchOptionsDisabledDescription = formatUnavailableDescription({
    title: optionDisabledTitle ?? createDisabledTitle,
    reason: optionDisabledReason ?? createDisabledReason,
    fallback: menuCopy.optionsUnavailableFallback,
  });
  const currentOptionItemLabel =
    currentOptionLabel !== undefined && currentOptionLabel !== null && onClear
      ? currentOptionLabel
      : null;
  const hasCurrentItem = currentOptionItemLabel !== null;
  const hasOptionsSection =
    loading ||
    showCreateItem ||
    branchOptions.length > 0 ||
    ((branchOptionsDisabled || createDisabled) && options.length > 0);
  const showOptionsSearch =
    branchOptions.length > 0 &&
    !branchOptionsDisabled &&
    !checkoutSectionDisabled;
  const optionsSectionDisabled =
    checkoutSectionDisabled || branchOptionsDisabled;
  const optionsSectionDisabledTitle =
    optionDisabledTitle ?? createDisabledTitle;
  const titleSubtitle =
    menuCopy.optionsSectionLabel === null && optionsSectionDisabled
      ? branchOptionsDisabledDescription
      : undefined;
  const titleSubtitleTitle =
    menuCopy.optionsSectionLabel === null
      ? optionsSectionDisabledTitle
      : undefined;
  const selectBranchAndClose = (branch: string) => {
    onChange(branch);
    setOpen(false);
  };

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => {
      window.cancelAnimationFrame(frame);
    };
  }, [open]);

  return (
    <Popover
      modal={modal}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        onOpenChange?.(nextOpen);
      }}
    >
      <PopoverTrigger asChild disabled={disabled}>
        <Button
          type="button"
          variant={variant === "default" ? "outline" : "ghost"}
          size="sm"
          disabled={disabled}
          aria-label="Branch"
          title={
            triggerTitle ??
            (isCreatingNew
              ? CREATE_NEW_BRANCH_LABEL
              : value
                ? `Branch: ${value}`
                : unresolvedTriggerLabel)
          }
          className={cn(
            variant === "default" &&
              "h-8 w-full min-w-0 justify-between rounded-md border-border bg-background px-2.5 text-sm font-normal shadow-none hover:bg-state-hover",
            variant === "minimal" &&
              "h-5 w-auto min-w-0 justify-between gap-1 rounded-sm px-0 text-xs font-normal shadow-none hover:bg-transparent data-[state=open]:bg-transparent data-[state=open]:hover:bg-transparent",
            variant === "minimal" &&
              muted &&
              "text-muted-foreground hover:text-foreground",
            variant === "option" &&
              cn(OPTION_BASE_CLASS_NAME, OPTION_INTERACTIVE_CLASS_NAME),
            variant === "option" && muted && OPTION_MUTED_CLASS_NAME,
            className,
          )}
          role="combobox"
          aria-expanded={open}
        >
          {variant === "option" ? (
            <span className={OPTION_CONTENT_CLASS_NAME}>
              <Icon
                name="GitMerge"
                className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
              />
              <BranchPickerText
                label={triggerLabel}
                isCreatingNew={isCreatingNew}
                emphasizePlainLabel={triggerHasPlainBranchValue}
                className="truncate"
              />
            </span>
          ) : (
            <BranchPickerText
              label={triggerLabel}
              isCreatingNew={isCreatingNew}
              emphasizePlainLabel={triggerHasPlainBranchValue}
              className="truncate text-left"
            />
          )}
          <Icon
            name="ChevronDown"
            className={cn(
              "shrink-0 text-muted-foreground",
              variant === "default" && "size-4",
              variant === "minimal" && "size-3",
              variant === "option" && COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            )}
          />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align={popoverAlign}
        sideOffset={6}
        collisionPadding={16}
        mobileTitle={menuCopy.title ?? "Branch"}
        className="flex flex-col overflow-hidden p-0 md:max-h-[calc(100vh-6rem)] md:w-[18rem] md:min-w-[min(var(--radix-popover-trigger-width),calc(100vw-2rem))] md:max-w-[calc(100vw-2rem)]"
      >
        {showOptionsSearch ? (
          <BranchPickerSearch
            inputRef={inputRef}
            query={query}
            enterSelection={enterSelection}
            onEnterSelection={selectBranchAndClose}
            onQueryChange={setQuery}
          />
        ) : null}
        <div
          className="min-h-0 max-h-[60vh] overflow-y-auto overscroll-contain p-1 md:max-h-80"
          onWheel={(event) => {
            event.stopPropagation();
          }}
        >
          {menuCopy.title ? (
            <BranchPickerSectionHeader
              label={menuCopy.title}
              subtitle={titleSubtitle}
              subtitleTitle={titleSubtitleTitle}
            />
          ) : null}
          {hasCurrentItem ? (
            <>
              {currentOptionItemLabel !== null &&
              menuCopy.currentSectionLabel ? (
                <BranchPickerSectionHeader
                  label={menuCopy.currentSectionLabel}
                />
              ) : null}
              {currentOptionItemLabel !== null && onClear ? (
                <BranchPickerRowButton
                  icon="GitMerge"
                  label={currentOptionItemLabel}
                  title={currentOptionTitle ?? currentOptionItemLabel}
                  selected={!isCreatingNew && value === null}
                  onSelect={() => {
                    onClear();
                    setOpen(false);
                  }}
                />
              ) : null}
            </>
          ) : null}
          {hasOptionsSection ? (
            <>
              {menuCopy.optionsSectionLabel ? (
                <BranchPickerSectionHeader
                  label={menuCopy.optionsSectionLabel}
                  subtitle={
                    optionsSectionDisabled
                      ? branchOptionsDisabledDescription
                      : undefined
                  }
                  subtitleTitle={optionsSectionDisabledTitle}
                  className={
                    hasCurrentItem
                      ? "mt-1 border-t border-border/60"
                      : undefined
                  }
                />
              ) : null}
              {optionsSectionDisabled ? null : (
                <>
                  {showCreateItem && onCreate ? (
                    createDisabled ? (
                      <BranchPickerUnavailableRow
                        icon="Plus"
                        label={CREATE_NEW_BRANCH_LABEL}
                        description={createDisabledDescription}
                        title={createDisabledTitle}
                      />
                    ) : (
                      <BranchPickerRowButton
                        icon="Plus"
                        label={CREATE_NEW_BRANCH_LABEL}
                        title={createDisabledTitle}
                        selected={isCreatingNew}
                        isCreatingNew
                        onSelect={() => {
                          onCreate();
                          setOpen(false);
                        }}
                      />
                    )
                  ) : null}
                  {filteredOptions.length > 0 ? (
                    filteredOptions.map((branch) => (
                      <BranchPickerRowButton
                        key={branch}
                        icon="GitMerge"
                        label={branch}
                        title={branch}
                        selected={!isCreatingNew && branch === value}
                        onSelect={() => selectBranchAndClose(branch)}
                      />
                    ))
                  ) : showCreateItem ? null : (
                    <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                      {loading ? "Loading branches..." : "No branches found."}
                    </p>
                  )}
                </>
              )}
            </>
          ) : hasCurrentItem ? null : (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              {loading ? "Loading branches..." : "No branches found."}
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
