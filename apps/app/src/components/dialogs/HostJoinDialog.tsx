import { useEffect, useState } from "react";
import type { Host } from "@bb/domain";
import type { CreateHostJoinResponse } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import { CopyButton } from "@/components/ui/copy-button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.js";
import { Icon } from "@/components/ui/icon.js";

const EXPIRATION_UPDATE_INTERVAL_MS = 1_000;

export interface HostJoinDialogProps {
  cancelPending: boolean;
  host: Host | null;
  open: boolean;
  target: CreateHostJoinResponse | null;
  onCancel: () => void;
  onDone: () => void;
  onOpenChange: (open: boolean) => void;
}

interface FormatRelativeExpirationArgs {
  expiresAt: number;
  now: number;
}

function formatRelativeExpiration({
  expiresAt,
  now,
}: FormatRelativeExpirationArgs): string {
  const remainingMs = expiresAt - now;
  if (remainingMs <= 0) {
    return "Expired";
  }

  const remainingSeconds = Math.ceil(remainingMs / 1_000);
  if (remainingSeconds < 60) {
    return `Expires in ${remainingSeconds}s`;
  }

  const remainingMinutes = Math.ceil(remainingSeconds / 60);
  return `Expires in ${remainingMinutes}m`;
}

export function HostJoinDialog({
  cancelPending,
  host,
  open,
  target,
  onCancel,
  onDone,
  onOpenChange,
}: HostJoinDialogProps) {
  const dialogOpen = open && target !== null;

  return (
    <Dialog open={dialogOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        {dialogOpen && target ? (
          <HostJoinDialogContent
            cancelPending={cancelPending}
            host={host}
            target={target}
            onCancel={onCancel}
            onClose={() => onOpenChange(false)}
            onDone={onDone}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export interface HostJoinDialogContentProps {
  cancelPending: boolean;
  host: Host | null;
  target: CreateHostJoinResponse;
  onCancel: () => void;
  onClose: () => void;
  onDone: () => void;
}

export function HostJoinDialogContent({
  cancelPending,
  host,
  target,
  onCancel,
  onClose,
  onDone,
}: HostJoinDialogContentProps) {
  const [now, setNow] = useState(Date.now);
  const connected = host?.status === "connected";
  const expired = target.expiresAt <= now;
  const statusLabel = connected
    ? "Host connected"
    : expired
      ? "Join command expired"
      : "Waiting for host";
  const statusIconName = connected
    ? "CircleCheck"
    : expired
      ? "AlertCircle"
      : "Spinner";
  const statusIconClassName = connected
    ? "size-4 text-success"
    : expired
      ? "size-4 text-destructive"
      : "size-4 animate-spin text-muted-foreground";

  useEffect(() => {
    const intervalId = window.setInterval(
      () => setNow(Date.now()),
      EXPIRATION_UPDATE_INTERVAL_MS,
    );
    return () => window.clearInterval(intervalId);
  }, []);

  return (
    <>
      <DialogHeader>
        <DialogTitle>New host</DialogTitle>
        <DialogDescription>
          Run this command from a bb checkout on the host.
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        <div
          className="flex items-center gap-2 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          <Icon
            name={statusIconName}
            className={statusIconClassName}
            aria-hidden="true"
          />
          <span className="font-medium">{statusLabel}</span>
        </div>

        <div className="rounded-md border border-border bg-muted/40">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-medium text-muted-foreground">
              CLI command
            </span>
            <CopyButton text={target.joinCommand} label="Copy host command" />
          </div>
          <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 text-xs leading-5">
            <code>{target.joinCommand}</code>
          </pre>
        </div>

        <div className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
          <span>Host ID: {target.hostId}</span>
          <span>
            {formatRelativeExpiration({ expiresAt: target.expiresAt, now })}
          </span>
        </div>
      </div>

      <DialogFooter>
        {connected ? (
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={cancelPending}
              onClick={onCancel}
            >
              {cancelPending ? "Canceling..." : "Cancel"}
            </Button>
            <Button type="button" disabled={cancelPending} onClick={onClose}>
              Close
            </Button>
          </>
        )}
      </DialogFooter>
    </>
  );
}
