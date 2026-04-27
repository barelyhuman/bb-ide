import { useStickToBottomContext } from "use-stick-to-bottom";
import { ScrollToBottomButton } from "@/components/shared/ScrollToBottomButton";

export function ThreadTimelineScrollToBottomButton() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  return (
    <ScrollToBottomButton
      visible={!isAtBottom}
      onClick={() => {
        void scrollToBottom();
      }}
    />
  );
}
