interface ConversationWorkingIndicatorProps {
  isThinking?: boolean
}

export function ConversationWorkingIndicator({
  isThinking = false,
}: ConversationWorkingIndicatorProps) {
  const label = isThinking ? "Thinking..." : "Working...";
  return (
    <div className="mt-4 px-2 text-sm text-muted-foreground" style={{ overflowAnchor: "none" }}>
      <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 shadow-sm backdrop-blur-sm">
        <span
          aria-hidden="true"
          className="size-2 rounded-full bg-current opacity-75 animate-pulse"
        />
        <span className="animate-shine">{label}</span>
      </div>
    </div>
  )
}
