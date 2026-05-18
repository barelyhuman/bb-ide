import { memo, useMemo, useRef } from "react";
import type { Host, ProjectSource } from "@bb/domain";
import {
  ExecutionControls,
  type ExecutionControlsProps,
  type ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import {
  PromptBoxInternal,
  type AttachmentsConfig,
  type HistoryConfig,
  type MentionsConfig,
  type PromptBoxHandle,
} from "@/components/promptbox/PromptBoxInternal";
import { usePromptVoice } from "@/components/promptbox/usePromptVoice";
import { BranchPicker } from "@/components/pickers/BranchPicker";
import {
  EnvironmentPickerUI,
  type EnvironmentPickerUIProps,
} from "@/components/pickers/EnvironmentPicker";
import { parseEnvironmentValue } from "@/components/pickers/environment-picker-value";
import { PermissionModePicker } from "@/components/pickers/PermissionModePicker";
import { useEffectiveHosts } from "@/hooks/queries/effective-hosts";
import { useHostDaemon } from "@/hooks/useHostDaemon";

export interface NewThreadEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
  hosts: readonly Host[];
  isLocalHost: EnvironmentPickerUIProps["isLocalHost"];
}

export interface NewThreadBranchConfig {
  value: string | null;
  isNew: boolean;
  options: readonly string[];
  loading?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  /**
   * When provided, the picker exposes a "Create new branch" item. Only set
   * for `host:local` (work locally / remotely) — managed-worktree
   * select an existing branch to use as the merge base.
   */
  onCreate?: () => void;
}

export interface NewThreadPromptBoxUIProps {
  /** id forwarded to the underlying PromptBoxInternal (used for autofocus targeting). */
  id?: string;

  // PromptBox passthrough
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  disabled: boolean;
  /** zenMode storage key used for the project-main zen-mode atom. */
  zenModeStorageKey: string;

  history: HistoryConfig;
  mentions: MentionsConfig;
  attachments: AttachmentsConfig;

  // Execution + environment + permission strip
  execution: ExecutionControlsProps;
  environment: NewThreadEnvironmentConfig;
  branch: NewThreadBranchConfig;
  permission: ExecutionPermissionConfig;
}

/**
 * Prop-only variant. Stories render this directly with mock host data; the
 * connected NewThreadPromptBox below wires up the real hooks.
 */
export const NewThreadPromptBoxUI = memo(function NewThreadPromptBoxUI({
  id,
  value,
  onChange,
  onSubmit,
  isSubmitting,
  disabled,
  zenModeStorageKey,
  history,
  mentions,
  attachments,
  execution,
  environment,
  branch,
  permission,
}: NewThreadPromptBoxUIProps) {
  const promptBoxRef = useRef<PromptBoxHandle>(null);
  const voice = usePromptVoice(promptBoxRef);
  const parsedEnvironment = parseEnvironmentValue(environment.value);
  const showBranchPicker = parsedEnvironment?.type === "host";
  return (
    <>
      <PromptBoxInternal
        id={id}
        promptBoxRef={promptBoxRef}
        value={value}
        onChange={onChange}
        onSubmit={onSubmit}
        autoFocus
        history={history}
        mentions={mentions}
        mentionMenuPlacement="bottom"
        attachments={attachments}
        voice={voice}
        submission={{
          isSubmitting,
          disabled,
          title: isSubmitting ? "Submitting..." : "Submit (Enter)",
        }}
        zenMode={{
          layout: "project-main",
          storageKey: zenModeStorageKey,
        }}
        footerStart={<ExecutionControls {...execution} />}
      />
      <div className="flex items-center justify-between gap-2 px-3.5">
        <div className="flex min-w-0 items-center gap-1">
          <EnvironmentPickerUI
            value={environment.value}
            onChange={environment.onChange}
            sources={environment.sources}
            hosts={environment.hosts}
            isLocalHost={environment.isLocalHost}
            muted
          />
          {showBranchPicker ? (
            <BranchPicker
              variant="option"
              muted
              value={branch.value}
              isCreatingNew={branch.isNew}
              options={branch.options}
              loading={branch.loading}
              placeholder={branch.placeholder}
              onChange={branch.onChange}
              onOpenChange={branch.onOpenChange}
              onCreate={branch.onCreate}
            />
          ) : null}
        </div>
        <PermissionModePicker
          value={permission.value}
          options={permission.options}
          onChange={permission.onChange}
          supported={permission.supported}
        />
      </div>
    </>
  );
});

export interface NewThreadConnectedEnvironmentConfig {
  value: string;
  onChange: (value: string) => void;
  sources: readonly ProjectSource[];
}

export interface NewThreadConnectedBranchConfig {
  current: string | null;
  value: string | null;
  isNew: boolean;
  options: readonly string[];
  loading?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onOpenChange?: (open: boolean) => void;
  onCreate: () => void;
}

export interface NewThreadPromptBoxProps extends Omit<
  NewThreadPromptBoxUIProps,
  "environment" | "branch"
> {
  environment: NewThreadConnectedEnvironmentConfig;
  branch: NewThreadConnectedBranchConfig;
}

/**
 * The composed prompt area for creating a new thread in a project — used by
 * ProjectMainView. Wires the host environment-picker queries, then
 * forwards everything to NewThreadPromptBoxUI.
 */
export function NewThreadPromptBox({
  environment,
  branch,
  ...rest
}: NewThreadPromptBoxProps) {
  const { isLocalHost } = useHostDaemon();
  const { data: hosts = [] } = useEffectiveHosts();

  const parsedEnvironment = parseEnvironmentValue(environment.value);
  const isHostMode = parsedEnvironment?.type === "host";

  // Create-new-branch is only meaningful for host:local (work locally /
  // remotely) — the server checks out a fresh branch in the primary checkout
  // before the thread starts. Worktree env modes use the picked
  // branch as a merge base instead, so we omit onCreate there.
  const allowCreate = isHostMode && parsedEnvironment.mode === "local";
  const branchPickerValue = branch.value ?? branch.current;
  const canCreate = allowCreate && branchPickerValue !== null;

  const uiEnvironment = useMemo(
    () => ({
      ...environment,
      hosts,
      isLocalHost,
    }),
    [environment, hosts, isLocalHost],
  );
  const uiBranch = useMemo(
    () => ({
      value: branchPickerValue,
      isNew: allowCreate && branch.isNew,
      options: branch.options,
      loading: branch.loading,
      placeholder: branch.placeholder,
      onChange: branch.onChange,
      onOpenChange: branch.onOpenChange,
      ...(canCreate ? { onCreate: branch.onCreate } : {}),
    }),
    [
      allowCreate,
      branch.isNew,
      branch.loading,
      branch.onChange,
      branch.onCreate,
      branch.onOpenChange,
      branch.options,
      branch.placeholder,
      branchPickerValue,
      canCreate,
    ],
  );

  return (
    <NewThreadPromptBoxUI
      {...rest}
      environment={uiEnvironment}
      branch={uiBranch}
    />
  );
}
