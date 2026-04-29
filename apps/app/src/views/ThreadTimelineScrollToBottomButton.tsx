import { useBottomAnchoredScroll } from "@/components/layout/BottomAnchoredScrollBody";
import { ScrollToBottomButton } from "@/components/shared/ScrollToBottomButton";

export function ThreadTimelineScrollToBottomButton() {
  const bottomAnchor = useBottomAnchoredScroll();
  if (!bottomAnchor) return null;

  return (
    <ScrollToBottomButton
      visible={!bottomAnchor.isAtBottom}
      onClick={bottomAnchor.scrollToBottom}
    />
  );
}
