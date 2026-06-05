import type { Host } from "@bb/domain";
import { HostPicker } from "./HostPicker";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { HOST_IDS, HOST_NAMES, makeHost } from "../../../.ladle/story-fixtures";

export default {
  title: "pickers/Host Picker",
};

const localOnly: Host[] = [makeHost()];

const multipleHosts: Host[] = [
  makeHost(),
  makeHost({
    id: "host_remote_build",
    name: "remote-build-box",
    type: "persistent",
  }),
  makeHost({
    id: "host_remote_stale",
    name: "remote-stale-box",
    type: "persistent",
    status: "disconnected",
  }),
];

const isLocalHost = (id: string | null | undefined) => id === HOST_IDS.local;
const noop = () => {};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="local host">
        <HostPicker
          hosts={localOnly}
          eligibleHosts={localOnly}
          selectedHostId={HOST_IDS.local}
          onChange={noop}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow label={`${HOST_NAMES.local}, secondary host selected`}>
        <HostPicker
          hosts={multipleHosts}
          eligibleHosts={multipleHosts}
          selectedHostId="host_remote_build"
          onChange={noop}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow label="disconnected" hint="HostStatusBadge connected=false">
        <HostPicker
          hosts={multipleHosts}
          eligibleHosts={multipleHosts}
          selectedHostId="host_remote_stale"
          onChange={noop}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow label="no hosts" hint="eligibleHosts is empty">
        <HostPicker
          hosts={[]}
          eligibleHosts={[]}
          selectedHostId=""
          onChange={noop}
          isLocalHost={isLocalHost}
        />
      </StoryRow>
      <StoryRow label="open menu" hint="defaultOpen + modal=false">
        <HostPicker
          hosts={multipleHosts}
          eligibleHosts={multipleHosts}
          selectedHostId={HOST_IDS.local}
          onChange={noop}
          isLocalHost={isLocalHost}
          defaultOpen
          modal={false}
        />
      </StoryRow>
    </StoryCard>
  );
}
