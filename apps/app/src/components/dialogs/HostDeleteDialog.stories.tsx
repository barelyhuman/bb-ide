import {
  HostDeleteDialogContent,
  type HostDeleteDialogTarget,
} from "./HostDeleteDialog";
import { HOST_IDS, HOST_NAMES } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Host Delete",
};

const noop = () => {};

const target: HostDeleteDialogTarget = {
  id: HOST_IDS.remote,
  name: HOST_NAMES.remote,
};

const longNameTarget: HostDeleteDialogTarget = {
  id: "host_remote_build_001",
  name: "michael-remote-build-box-001",
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="default" hint="persistent remote host">
        <DialogStage>
          <HostDeleteDialogContent
            target={target}
            pending={false}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="long name"
        hint="long host identifier in the description"
      >
        <DialogStage>
          <HostDeleteDialogContent
            target={longNameTarget}
            pending={false}
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="pending" hint="destructive button disabled">
        <DialogStage>
          <HostDeleteDialogContent
            target={target}
            pending
            onDelete={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
