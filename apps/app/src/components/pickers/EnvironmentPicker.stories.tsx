import type { ProjectSource } from "@bb/domain";
import { EnvironmentPickerUI } from "./EnvironmentPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { HOST_IDS } from "../../../.ladle/story-fixtures";

export default {
  title: "pickers/Environment Picker",
};

function makeSource(id: string, hostId: string, path: string): ProjectSource {
  return {
    id,
    projectId: "proj_demo",
    type: "local_path",
    hostId,
    path,
    isDefault: id === "src_local",
    createdAt: 0,
    updatedAt: 0,
  };
}

const localProjectSources: readonly ProjectSource[] = [
  makeSource("src_local", HOST_IDS.local, "/Users/michael/Projects/bb"),
];

const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="local direct" hint="selected: Work locally">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:local`}
          onChange={noop}
          sources={localProjectSources}
          hostId={HOST_IDS.local}
        />
      </StoryRow>
      <StoryRow label="muted" hint="prompt-box treatment">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:local`}
          onChange={noop}
          sources={localProjectSources}
          hostId={HOST_IDS.local}
          muted
        />
      </StoryRow>
      <StoryRow label="local worktree" hint="selected: New worktree">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:worktree`}
          onChange={noop}
          sources={localProjectSources}
          hostId={HOST_IDS.local}
        />
      </StoryRow>
      <StoryRow
        label="reuse selected"
        hint="env mode is reuse — button shows 'Reuse worktree'; the specific worktree lives in the adjacent WorktreePicker"
      >
        <EnvironmentPickerUI
          value="reuse"
          onChange={noop}
          sources={localProjectSources}
          hostId={HOST_IDS.local}
        />
      </StoryRow>
      <StoryRow
        label="no worktrees to reuse"
        hint="reuseDisabled — open the menu to see the 'Existing worktree' row disabled with a hint about why"
      >
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:local`}
          onChange={noop}
          sources={localProjectSources}
          hostId={HOST_IDS.local}
          reuseDisabled
        />
      </StoryRow>
      <StoryRow label="open menu" hint="defaultOpen + modal=false">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:local`}
          onChange={noop}
          sources={localProjectSources}
          hostId={HOST_IDS.local}
          defaultOpen
          modal={false}
        />
      </StoryRow>
    </StoryCard>
  );
}
