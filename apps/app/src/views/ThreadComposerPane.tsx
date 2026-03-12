import { type ComponentProps } from "react";
import { ThreadFollowUpComposer } from "./ThreadFollowUpComposer";

type ThreadComposerPaneProps = ComponentProps<typeof ThreadFollowUpComposer>;

export function ThreadComposerPane(props: ThreadComposerPaneProps) {
  return <ThreadFollowUpComposer {...props} />;
}
