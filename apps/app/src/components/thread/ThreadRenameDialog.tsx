import { useId, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"

export interface ThreadRenameDialogTarget {
  id: string
  currentTitle: string
}

interface ThreadRenameDialogProps {
  target: ThreadRenameDialogTarget | null
  pending?: boolean
  onOpenChange: (open: boolean) => void
  onRename: (threadId: string, title: string) => void
}

export function ThreadRenameDialog({
  target,
  pending = false,
  onOpenChange,
  onRename,
}: ThreadRenameDialogProps) {
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        {target ? (
          <ThreadRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            onOpenChange={onOpenChange}
            onRename={onRename}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ThreadRenameDialogContent({
  target,
  pending,
  onOpenChange,
  onRename,
}: {
  target: ThreadRenameDialogTarget
  pending: boolean
  onOpenChange: (open: boolean) => void
  onRename: (threadId: string, title: string) => void
}) {
  const inputId = useId()
  const [nextTitle, setNextTitle] = useState(target.currentTitle)
  const [validationMessage, setValidationMessage] = useState<string | null>(null)

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return

    const trimmedTitle = nextTitle.trim()
    if (!trimmedTitle) {
      setValidationMessage("Thread name cannot be empty.")
      return
    }

    onRename(target.id, trimmedTitle)
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename thread</DialogTitle>
        <DialogDescription>Choose a new name for this thread.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            id={inputId}
            aria-label="Thread name"
            value={nextTitle}
            autoFocus
            disabled={pending}
            onChange={(event) => {
              setNextTitle(event.target.value)
              if (validationMessage) {
                setValidationMessage(null)
              }
            }}
          />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            Rename thread
          </Button>
        </DialogFooter>
      </form>
    </>
  )
}
