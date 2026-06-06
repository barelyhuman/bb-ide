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
  DropdownMenuLabel,
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
        className="min-w-52 max-w-80 divide-y [&>*+*]:pt-2 [&>*:not(:last-child)]:pb-2"
        mobileTitle="Environment"
      >
        <WorkspaceModeSection
          hostId={hostId}
          enabled={hostId !== null && hasSource}
          value={value}
          onChange={onChange}
        />
        <ReuseSection
          isReuseSelected={parsed?.type === "reuse"}
          disabled={Boolean(reuseDisabled)}
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

// ---------------------------------------------------------------------------
// Reuse section — single entry, sets the value to the bare reuse marker.
// The actual worktree picker lives beside the env picker (see WorktreePicker).
// ---------------------------------------------------------------------------

interface ReuseSectionProps {
  isReuseSelected: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
}

function ReuseSection({
  isReuseSelected,
  disabled,
  onChange,
}: ReuseSectionProps) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Reuse</DropdownMenuLabel>
      <DropdownMenuItem
        disabled={disabled}
        onSelect={() => {
          if (disabled) return;
          onChange(REUSE_VALUE_WITHOUT_ENVIRONMENT);
        }}
        className="flex items-center justify-between gap-3"
      >
        <span className="flex min-w-0 items-center gap-2">
          <Icon
            name={getEnvironmentWorkspaceLabelIconName("managed-worktree")}
            className={cn(
              "text-muted-foreground",
              COARSE_POINTER_COMPACT_ICON_SIZE_SHRINK_CLASS,
            )}
          />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-xs">Existing worktree</span>
            {disabled ? (
              // No extra muting: the disabled DropdownMenuItem already
              // applies opacity-50 to its content. Stacking more dimming
              // here would make the subtitle barely readable.
              <span className="text-xs">No worktrees in this project yet</span>
            ) : null}
          </span>
        </span>
        <Icon
          name="Check"
          className={cn(
            COARSE_POINTER_ICON_SIZE_CLASS,
            isReuseSelected ? "opacity-100" : "opacity-0",
          )}
        />
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

// ---------------------------------------------------------------------------
// Workspace mode section
// ---------------------------------------------------------------------------

interface WorkspaceModeSectionProps {
  hostId: string | null;
  enabled: boolean;
  value: string;
  onChange: (value: string) => void;
}

function WorkspaceModeSection({
  hostId,
  enabled,
  value,
  onChange,
}: WorkspaceModeSectionProps) {
  const localValue = hostId ? encodeHostValue(hostId, "local") : "";
  const worktreeValue = hostId ? encodeHostValue(hostId, "worktree") : "";

  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel>Workspace</DropdownMenuLabel>
      {enabled ? (
        <>
          <EnvironmentMenuItem
            label="Work locally"
            icon={getEnvironmentWorkspaceLabelIconName("other")}
            itemValue={localValue}
            selectedValue={value}
            onSelect={onChange}
          />
          <EnvironmentMenuItem
            label="New worktree"
            icon={getEnvironmentWorkspaceLabelIconName("managed-worktree")}
            itemValue={worktreeValue}
            selectedValue={value}
            onSelect={onChange}
          />
        </>
      ) : (
        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
          Project source unavailable
        </DropdownMenuItem>
      )}
    </DropdownMenuGroup>
  );
}

// Shared menu item
// ---------------------------------------------------------------------------

interface EnvironmentMenuItemProps {
  label: string;
  icon: IconName;
  itemValue: string;
  selectedValue: string;
  onSelect: (value: string) => void;
  disabled?: boolean;
}

function EnvironmentMenuItem({
  label,
  icon,
  itemValue,
  selectedValue,
  onSelect,
  disabled,
}: EnvironmentMenuItemProps) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      onSelect={() => onSelect(itemValue)}
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
        <span className="truncate text-xs">{label}</span>
      </span>
      <Icon
        name="Check"
        className={cn(
          COARSE_POINTER_ICON_SIZE_CLASS,
          itemValue === selectedValue ? "opacity-100" : "opacity-0",
        )}
      />
    </DropdownMenuItem>
  );
}
