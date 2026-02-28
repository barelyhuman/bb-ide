import { Archive, Circle, MoreHorizontal, PencilLine, RotateCcw } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"

interface ThreadActionsMenuProps {
  onMarkUnread: () => void
  onRename: () => void
  onToggleArchive: () => void
  isArchived: boolean
  disabled?: boolean
  triggerClassName?: string
  align?: "start" | "center" | "end"
}

export function ThreadActionsMenu({
  onMarkUnread,
  onRename,
  onToggleArchive,
  isArchived,
  disabled = false,
  triggerClassName,
  align = "end",
}: ThreadActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={triggerClassName}
          aria-label="Thread actions"
          title="Thread actions"
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault()
            event.stopPropagation()
          }}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-44">
        <DropdownMenuItem
          disabled={disabled}
          onSelect={(event) => {
            event.preventDefault()
            onMarkUnread()
          }}
        >
          <Circle className="size-4" />
          Mark as unread
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onSelect={(event) => {
            event.preventDefault()
            onRename()
          }}
        >
          <PencilLine className="size-4" />
          Rename thread
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onSelect={(event) => {
            event.preventDefault()
            onToggleArchive()
          }}
        >
          {isArchived ? <RotateCcw className="size-4" /> : <Archive className="size-4" />}
          {isArchived ? "Unarchive" : "Archive"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
