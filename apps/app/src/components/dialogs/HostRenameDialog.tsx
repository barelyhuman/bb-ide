import { useId, useState, type FormEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button.js";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog.js";
import { Input } from "@/components/ui/input.js";
import { useRenameDialogAutoFocus } from "./useRenameDialogAutoFocus.js";

export interface HostRenameDialogTarget {
  id: string;
  currentName: string;
}

interface HostRenameDialogProps {
  target: HostRenameDialogTarget | null;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onRename: (hostId: string, name: string) => void;
}

export function HostRenameDialog({
  target,
  pending,
  onOpenChange,
  onRename,
}: HostRenameDialogProps) {
  const { inputRef, handleOpenAutoFocus } = useRenameDialogAutoFocus();
  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent onOpenAutoFocus={handleOpenAutoFocus}>
        {target ? (
          <HostRenameDialogContent
            key={target.id}
            target={target}
            pending={pending}
            onRename={onRename}
            inputRef={inputRef}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface HostRenameDialogContentProps {
  target: HostRenameDialogTarget;
  pending: boolean;
  onRename: (hostId: string, name: string) => void;
  inputRef: RefObject<HTMLInputElement | null>;
}

export function HostRenameDialogContent({
  target,
  pending,
  onRename,
  inputRef,
}: HostRenameDialogContentProps) {
  const inputId = useId();
  const [nextName, setNextName] = useState(target.currentName);
  const [validationMessage, setValidationMessage] = useState<string | null>(
    null,
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;

    const trimmedName = nextName.trim();
    if (!trimmedName) {
      setValidationMessage("Host name cannot be empty.");
      return;
    }

    onRename(target.id, trimmedName);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Rename host</DialogTitle>
        <DialogDescription>Choose a new name for this host.</DialogDescription>
      </DialogHeader>
      <form className="space-y-4" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Input
            ref={inputRef}
            id={inputId}
            aria-label="Host name"
            value={nextName}
            disabled={pending}
            onChange={(event) => {
              setNextName(event.target.value);
              if (validationMessage) {
                setValidationMessage(null);
              }
            }}
          />
          {validationMessage ? (
            <p className="text-sm text-destructive">{validationMessage}</p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="submit" disabled={pending}>
            Rename host
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
