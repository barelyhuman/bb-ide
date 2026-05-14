import type { CreateHostJoinResponse } from "@bb/server-contract";
import { HostJoinDialogContent } from "./HostJoinDialog";
import { HOST_IDS, HOST_NAMES, makeHost } from "../../../.ladle/story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Host Join",
};

const noop = () => {};

const pendingTarget: CreateHostJoinResponse = {
  expiresAt: Date.now() + 5 * 60 * 1_000,
  hostId: HOST_IDS.remote,
  joinCode: "bbde_story_join_code",
  joinCommand:
    "BB_SERVER_URL='http://server-machine.example-tailnet.ts.net:38886' BB_HOST_ID='host_remote' BB_HOST_TYPE='persistent' BB_HOST_ENROLL_KEY='bbde_story_join_code_with_a_long_wrapping_token_value' pnpm start:host-daemon",
};

const connectedTarget: CreateHostJoinResponse = {
  ...pendingTarget,
  joinCode: "bbde_connected_story_join_code",
};

const expiredTarget: CreateHostJoinResponse = {
  ...pendingTarget,
  expiresAt: Date.now() - 1_000,
  joinCode: "bbde_expired_story_join_code",
};

const waitingHost = makeHost({
  id: HOST_IDS.remote,
  name: "pending-remote",
  status: "disconnected",
});

const connectedHost = makeHost({
  id: HOST_IDS.remote,
  name: HOST_NAMES.remote,
  status: "connected",
});

export function Overview() {
  return (
    <StoryCard>
      <StoryRow label="waiting" hint="join command ready for remote host">
        <DialogStage>
          <HostJoinDialogContent
            cancelPending={false}
            host={waitingHost}
            target={pendingTarget}
            onCancel={noop}
            onClose={noop}
            onDone={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="canceling" hint="cleanup request in flight">
        <DialogStage>
          <HostJoinDialogContent
            cancelPending
            host={waitingHost}
            target={pendingTarget}
            onCancel={noop}
            onClose={noop}
            onDone={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="expired" hint="join command is no longer valid">
        <DialogStage>
          <HostJoinDialogContent
            cancelPending={false}
            host={waitingHost}
            target={expiredTarget}
            onCancel={noop}
            onClose={noop}
            onDone={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow label="connected" hint="daemon has opened a host session">
        <DialogStage>
          <HostJoinDialogContent
            cancelPending={false}
            host={connectedHost}
            target={connectedTarget}
            onCancel={noop}
            onClose={noop}
            onDone={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
