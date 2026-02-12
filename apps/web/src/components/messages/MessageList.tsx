import { useAutoScroll } from "@/hooks/useAutoScroll"
import { MessageRow } from "./MessageRow"
import { WorkingIndicator } from "./WorkingIndicator"

interface Message {
  id: string
  role: "user" | "assistant"
  content: string
}

interface MessageListProps {
  messages: Message[]
  isWorking?: boolean
  workingStartTime?: number
}

export function MessageList({ messages, isWorking, workingStartTime }: MessageListProps) {
  const { containerRef, handleScroll } = useAutoScroll(messages)

  if (messages.length === 0 && !isWorking) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground text-sm">
        <p className="mb-4">Start by creating a thread prompt.</p>
        <div className="space-y-1 text-muted-foreground/70">
          <p>"Implement user authentication with JWT"</p>
          <p>"Review the auth module, then run tests"</p>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="flex-1 overflow-y-auto"
    >
      <div className="space-y-3 p-4">
        {messages.map((msg) => (
          <MessageRow key={msg.id} role={msg.role} content={msg.content} />
        ))}
        {isWorking && <WorkingIndicator startTime={workingStartTime} />}
      </div>
    </div>
  )
}
