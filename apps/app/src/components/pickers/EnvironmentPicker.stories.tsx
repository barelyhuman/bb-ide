import type { Host, ProjectSource } from "@bb/domain";
import { EnvironmentPickerUI } from "./EnvironmentPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { HOST_IDS, makeHost } from "../../../.ladle/story-fixtures";

export default {
  title: "pickers/Environment Picker",
};

const mockHosts: Host[] = [
  makeHost(),
  makeHost({ id: "host_mac_mini", name: "Mac Studio (office)" }),
  makeHost({
    id: "host_old_laptop",
    name: "Linux laptop",
    status: "disconnected",
  }),
];

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

const multiHostSources: readonly ProjectSource[] = [
  makeSource("src_local", HOST_IDS.local, "/Users/michael/Projects/bb"),
  makeSource("src_remote", "host_mac_mini", "/Users/michael/projects/bb"),
];

const isLocalHost = (id: string | null | undefined) => id === HOST_IDS.local;
const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="local direct" hint="host: local + mode: local">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:local`}
          onChange={noop}
          sources={localProjectSources}
          hosts={mockHosts}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow label="muted" hint="prompt-box treatment">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:local`}
          onChange={noop}
          sources={localProjectSources}
          hosts={mockHosts}
          isLocalHost={isLocalHost}
          muted
        />
      </StoryRow>
      <StoryRow label="local worktree" hint="host: local + mode: worktree">
        <EnvironmentPickerUI
          value={`host:${HOST_IDS.local}:worktree`}
          onChange={noop}
          sources={localProjectSources}
          hosts={mockHosts}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow
        label="remote host direct"
        hint="host: mac-mini-studio + mode: local"
      >
        <EnvironmentPickerUI
          value="host:host_mac_mini:local"
          onChange={noop}
          sources={multiHostSources}
          hosts={mockHosts}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow
        label="remote host worktree"
        hint="host: mac-mini-studio + mode: worktree"
      >
        <EnvironmentPickerUI
          value="host:host_mac_mini:worktree"
          onChange={noop}
          sources={multiHostSources}
          hosts={mockHosts}
          isLocalHost={isLocalHost}
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
          hosts={mockHosts}
          isLocalHost={isLocalHost}
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
          hosts={mockHosts}
          isLocalHost={isLocalHost}
          reuseDisabled
        />
      </StoryRow>
    </StoryCard>
  );
}
