import type { UIAssistantTextMessage } from "@beanbag/agent-core";
import { ConversationMarkdown } from "../ConversationMarkdown";

export function AssistantMessageRow({
  message,
}: {
  message: UIAssistantTextMessage;
}) {
  return (
    <div className="group w-full" style={{ overflowAnchor: "none" }}>
      <div className="mr-auto w-full">
        <div className="rounded-md px-2 py-1">
          <ConversationMarkdown content={message.text} />
        </div>
      </div>
    </div>
  );
}
