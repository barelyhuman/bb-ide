import { ConversationStatusIndicator } from "@/components/messages/ConversationStatusIndicator";
import { cn } from "@/lib/utils";

interface ConversationWorkingIndicatorProps {
  label?: string;
  isThinking?: boolean;
  className?: string;
}

export function ConversationWorkingIndicator({
  label,
  isThinking = false,
  className,
}: ConversationWorkingIndicatorProps) {
  return (
    <div style={{ overflowAnchor: "none" }}>
      <ConversationStatusIndicator
        label={label ?? (isThinking ? "Thinking..." : "Working...")}
        className={cn("mt-4", className)}
      />
    </div>
  );
}
