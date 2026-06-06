import { useMemo } from "react";
import type { ProjectSource } from "@bb/domain";
import { Icon, type IconName } from "@/components/ui/icon.js";
import { findLocalPathProjectSourceForHost } from "@bb/domain";
import { Button } from "@/components/ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu.js";
import {
  COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
  COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
  COARSE_POINTER_ICON_SIZE_CLASS,
} from "@/components/ui/coarse-pointer-sizing.js";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getEnvironmentWorkspaceLabelIconName } from "@/lib/environment-workspace-display";
import { cn } from "@/lib/utils";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
  OPTION_TRIGGER_CONTENT_CLASS_NAME,
} from "./OptionPicker";
import {
  encodeHostValue,
  parseEnvironmentValue,
  REUSE_VALUE_WITHOUT_ENVIRONMENT,
} from "./environment-picker-value";

// ---------------------------------------------------------------------------
// Pure presentational picker. Use directly in stories with mocked data.
// App callers should use EnvironmentPicker (the connected wrapper below).
// ---------------------------------------------------------------------------

interface SelectedEnvironment {
  modeLabel: string;
  compactModeLabel: string;
  icon: IconName;
}

export interface EnvironmentPickerUIProps {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  hostId: string | null;
  /** When true, the "Reuse existing worktree" entry is disabled — the
   * caller signals that the project has no worktree envs available to
   * reuse. The entry is always rendered so the affordance stays
   * discoverable; it just can't be selected. */
  reuseDisabled?: boolean;
  /** Render with the dim, hover-to-foreground treatment used inside the prompt box. */
  muted?: boolean;
  /** Render with the menu open on mount. Story-only escape hatch. */
  defaultOpen?: boolean;
  /** Whether the menu blocks page interaction. Defaults to Radix's true; pass false in stories. */
  modal?: boolean;
}

export function EnvironmentPickerUI({
  value,
  onChange,
  sources,
  hostId,
  reuseDisabled,
  muted,
  defaultOpen,
  modal,
}: EnvironmentPickerUIProps) {
  const hasSource = useMemo(
    () =>
      hostId !== null &&
      findLocalPathProjectSourceForHost(sources, hostId) !== undefined,
    [hostId, sources],
  );

  const parsed = useMemo(() => parseEnvironmentValue(value), [value]);

  const selected = useMemo((): SelectedEnvironment => {
    if (!parsed) {
      return {
        modeLabel: "Environment",
        compactModeLabel: "Env",
        icon: "Laptop" as const,
      };
    }
    if (parsed.type === "reuse") {
      return {
        modeLabel: "Reuse worktree",
        compactModeLabel: "Reuse",
        icon: getEnvironmentWorkspaceLabelIconName("managed-worktree"),
      };
    }
    const modeLabel =
      parsed.mode === "worktree" ? "New worktree" : "Work locally";
    const compactModeLabel =
      parsed.mode === "worktree" ? "Worktree" : "Local";
    const icon = getEnvironmentWorkspaceLabelIconName(
      parsed.mode === "worktree" ? "managed-worktree" : "other",
    );
    return { modeLabel, compactModeLabel, icon };
  }, [parsed]);

  return (
    <DropdownMenu defaultOpen={defaultOpen} modal={modal}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Environment"
          title={`Environment: ${selected.modeLabel}`}
          data-promptbox-icon-only-control=""
          className={cn(
            OPTION_BASE_CLASS_NAME,
            OPTION_INTERACTIVE_CLASS_NAME,
            muted && OPTION_MUTED_CLASS_NAME,
          )}
        >
          <span className={OPTION_TRIGGER_CONTENT_CLASS_NAME}>
            <Icon
              name={selected.icon}
              className={COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS}
            />
            <span className="min-w-0 truncate" data-promptbox-full-label="">
              {selected.modeLabel}
            </span>
            <span
              className="min-w-0 truncate"
              data-promptbox-compact-label=""
              data-promptbox-hide-tiny=""
            >
              {selected.compactModeLabel}
            </span>
          </span>
          <Icon
            name="ChevronDown"
            className={cn(
              "shrink-0 text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_CLASS,
            )}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="min-w-52 max-w-80"
        mobileTitle="Environment"
      >
        <EnvironmentOptionsSection
          hostId={hostId}
          hasProjectSource={hostId !== null && hasSource}
          reuseDisabled={Boolean(reuseDisabled)}
          selectedType={parsed?.type}
          value={value}
          onChange={onChange}
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ---------------------------------------------------------------------------
// Connected variant — wires app-wide hooks into the presentational
// EnvironmentPickerUI. App callers use this; stories use EnvironmentPickerUI
// directly with mocks.
// ---------------------------------------------------------------------------

export interface EnvironmentPickerProps {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  reuseDisabled?: boolean;
  muted?: boolean;
}

export function EnvironmentPicker({
  value,
  onChange,
  sources,
  reuseDisabled,
  muted,
}: EnvironmentPickerProps) {
  const { localHostId } = useHostDaemon();

  return (
    <EnvironmentPickerUI
      value={value}
      onChange={onChange}
      sources={sources}
      hostId={localHostId}
      reuseDisabled={reuseDisabled}
      muted={muted}
    />
  );
}

interface EnvironmentOptionsSectionProps {
  hostId: string | null;
  hasProjectSource: boolean;
  reuseDisabled: boolean;
  selectedType:
    | NonNullable<ReturnType<typeof parseEnvironmentValue>>["type"]
    | undefined;
  value: string;
  onChange: (value: string) => void;
}

function EnvironmentOptionsSection({
  hostId,
  hasProjectSource,
  reuseDisabled,
  selectedType,
  value,
  onChange,
}: EnvironmentOptionsSectionProps) {
  const localValue = hostId ? encodeHostValue(hostId, "local") : null;
  const worktreeValue = hostId ? encodeHostValue(hostId, "worktree") : null;
  const workspaceDisabled = !hasProjectSource;
  const workspaceDisabledDescription = workspaceDisabled
    ? "Project source unavailable"
    : undefined;

  return (
    <DropdownMenuGroup>
      <EnvironmentMenuItem
        label="Work locally"
        description={workspaceDisabledDescription}
        icon={getEnvironmentWorkspaceLabelIconName("other")}
        selected={localValue !== null && value === localValue}
        disabled={workspaceDisabled || localValue === null}
        onSelect={() => {
          if (localValue !== null) onChange(localValue);
        }}
      />
      <EnvironmentMenuItem
        label="New worktree"
        description={workspaceDisabledDescription}
        icon={getEnvironmentWorkspaceLabelIconName("managed-worktree")}
        selected={worktreeValue !== null && value === worktreeValue}
        disabled={workspaceDisabled || worktreeValue === null}
        onSelect={() => {
          if (worktreeValue !== null) onChange(worktreeValue);
        }}
      />
      <EnvironmentMenuItem
        label="Existing worktree"
        description={
          reuseDisabled ? "No worktrees in this project yet" : undefined
        }
        icon={getEnvironmentWorkspaceLabelIconName("managed-worktree")}
        selected={selectedType === "reuse"}
        disabled={reuseDisabled}
        onSelect={() => onChange(REUSE_VALUE_WITHOUT_ENVIRONMENT)}
      />
    </DropdownMenuGroup>
  );
}

// Shared menu item
// ---------------------------------------------------------------------------

interface EnvironmentMenuItemProps {
  label: string;
  description?: string;
  icon: IconName;
  selected: boolean;
  onSelect: () => void;
  disabled?: boolean;
}

function EnvironmentMenuItem({
  label,
  description,
  icon,
  selected,
  onSelect,
  disabled,
}: EnvironmentMenuItemProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => {
        if (disabled) return;
        onSelect();
      }}
      className="flex items-center justify-between gap-3"
    >
      <span className="flex min-w-0 items-center gap-2">
        <Icon
          name={icon}
          className={cn(
            "text-muted-foreground",
            COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
          )}
        />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-xs">{label}</span>
          {description ? <span className="text-xs">{description}</span> : null}
        </span>
      </span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          selected ? "opacity-100" : "opacity-0",
        )}
      />
    </DropdownMenuItem>
  );
}
