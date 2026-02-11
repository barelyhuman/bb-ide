import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"

interface WorkingIndicatorProps {
  startTime?: number
}

export function WorkingIndicator({ startTime }: WorkingIndicatorProps) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) return
    const timer = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }, 1000)
    return () => clearInterval(timer)
  }, [startTime])

  const display = startTime ? `${elapsed}s` : ""

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" />
      <span className="animate-shine">Working{display ? ` · ${display}` : "..."}</span>
    </div>
  )
}
