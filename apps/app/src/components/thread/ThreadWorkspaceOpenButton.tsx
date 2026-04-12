import { useCallback, useState } from "react";
import { Check, ChevronDown, Code2, FolderOpen, Terminal, Wrench } from "lucide-react";
import type {
  WorkspaceOpenTarget,
  WorkspaceOpenTargetId,
} from "@bb/host-daemon-contract";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import {
  resolvePreferredWorkspaceOpenTarget,
  useWorkspaceOpenTargetPreference,
} from "@/lib/workspace-open-target-preference";
import { toast } from "sonner";

const WORKSPACE_OPEN_BUTTON_CLASS =
  "h-7 rounded-md border-border/70 bg-background/70 px-2 text-xs font-medium text-foreground/85 shadow-none hover:bg-muted/45 hover:text-foreground";

interface ThreadWorkspaceOpenButtonProps {
  onOpenWorkspace: (targetId: WorkspaceOpenTargetId) => Promise<void>;
  targets: WorkspaceOpenTarget[];
}

interface WorkspaceOpenTargetIconProps {
  target: WorkspaceOpenTarget;
}

function WorkspaceOpenTargetIcon({ target }: WorkspaceOpenTargetIconProps) {
  switch (target.kind) {
    case "file-manager":
      return <FolderOpen className="size-3.5" />;
    case "terminal":
      return <Terminal className="size-3.5" />;
    case "ide":
      return <Wrench className="size-3.5" />;
    case "editor":
      return <Code2 className="size-3.5" />;
    default: {
      const _exhaustive: never = target.kind;
      return _exhaustive;
    }
  }
}

export function ThreadWorkspaceOpenButton({
  onOpenWorkspace,
  targets,
}: ThreadWorkspaceOpenButtonProps) {
  const [preferredTargetId, setPreferredTargetId] = useWorkspaceOpenTargetPreference();
  const [pendingTargetId, setPendingTargetId] = useState<WorkspaceOpenTargetId | null>(null);
  const selectedTarget = resolvePreferredWorkspaceOpenTarget({
    preferredTargetId,
    targets,
  });
  const isPending = pendingTargetId !== null;

  const openTarget = useCallback(
    async (target: WorkspaceOpenTarget, storePreference: boolean) => {
      if (pendingTargetId !== null) {
        return;
      }

      if (storePreference) {
        setPreferredTargetId(target.id);
      }

      setPendingTargetId(target.id);
      try {
        await onOpenWorkspace(target.id);
      } catch {
        toast.error(`Could not open workspace in ${target.label}.`);
      } finally {
        setPendingTargetId(null);
      }
    },
    [onOpenWorkspace, pendingTargetId, setPreferredTargetId],
  );

  if (!selectedTarget) {
    return null;
  }

  return (
    <div className="inline-flex items-center">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={isPending}
        className={cn(WORKSPACE_OPEN_BUTTON_CLASS, "rounded-r-none border-r-0 px-2")}
        aria-label={`Open workspace in ${selectedTarget.label}`}
        title={`Open workspace in ${selectedTarget.label}`}
        onClick={() => {
          void openTarget(selectedTarget, false);
        }}
      >
        <WorkspaceOpenTargetIcon target={selectedTarget} />
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={isPending}
            className={cn(WORKSPACE_OPEN_BUTTON_CLASS, "rounded-l-none px-1")}
            aria-label="Choose workspace open target"
            title="Choose workspace open target"
          >
            <ChevronDown className="size-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={2} mobileTitle="Open Workspace">
          {targets.map((target) => (
            <DropdownMenuItem
              key={target.id}
              onSelect={() => {
                void openTarget(target, true);
              }}
            >
              <WorkspaceOpenTargetIcon target={target} />
              <span className="min-w-0 flex-1">{target.label}</span>
              {target.id === selectedTarget.id ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

