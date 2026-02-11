import { cn } from "@/lib/utils"

interface MessageRowProps {
  role: "user" | "assistant"
  content: string
}

export function MessageRow({ role, content }: MessageRowProps) {
  const isUser = role === "user"

  return (
    <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap",
          isUser
            ? "bg-primary text-primary-foreground"
            : "bg-muted border border-border",
        )}
      >
        {content}
      </div>
    </div>
  )
}
