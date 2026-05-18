import type { TerminalSession } from "@bb/server-contract";
import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { Skeleton } from "@/components/ui/skeleton.js";
import { TabPill } from "@/components/ui/tab-pill";
import {
  terminalStatusLabel,
  type ThreadTerminalController,
} from "./useThreadTerminalController";

interface ThreadTerminalTabStripProps {
  controller: ThreadTerminalController;
}

interface TerminalTabProps {
  isActive: boolean;
  isClosing: boolean;
  onClose: TerminalTabActionHandler;
  onSelect: TerminalTabActionHandler;
  session: TerminalSession;
}

type TerminalTabActionHandler = () => void;

export function ThreadTerminalTabStrip({
  controller,
}: ThreadTerminalTabStripProps) {
  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
      role="tablist"
      aria-label="Terminal sessions"
    >
      {controller.isTerminalQueryLoading ? (
        <>
          <Skeleton className="h-6 w-28 shrink-0 rounded-md" />
          <Skeleton className="h-6 w-24 shrink-0 rounded-md" />
        </>
      ) : controller.visibleSessions.length > 0 ? (
        controller.visibleSessions.map((session) => (
          <TerminalTab
            key={session.id}
            session={session}
            isActive={session.id === controller.activeTerminalId}
            isClosing={controller.closingTerminalId === session.id}
            onSelect={() => controller.handleSelectTerminal(session.id)}
            onClose={() => controller.handleCloseTerminal(session.id)}
          />
        ))
      ) : controller.showTerminalPlaceholders ? (
        <p className="shrink-0 text-xs text-muted-foreground">
          {controller.emptyTerminalMessage}
        </p>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 rounded-md p-0 text-muted-foreground"
        disabled={
          !controller.canCreateTerminal || controller.isCreateTerminalPending
        }
        onClick={controller.handleCreateTerminal}
        aria-label="New terminal"
        title="New terminal"
      >
        {controller.isCreateTerminalPending ? (
          <Icon name="Spinner" className="size-3.5 animate-spin" />
        ) : (
          <Icon name="Plus" className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

function TerminalTab({
  isActive,
  isClosing,
  onClose,
  onSelect,
  session,
}: TerminalTabProps) {
  const statusLabel = terminalStatusLabel(session);
  return (
    <TabPill
      label={session.title}
      secondaryLabel={session.status === "running" ? null : statusLabel}
      title={`${session.title} (${statusLabel})`}
      isActive={isActive}
      onSelect={onSelect}
      closeAction={{
        onClose,
        closeLabel: `Close ${session.title}`,
        closeTooltip: "Close terminal",
        isClosing,
      }}
    />
  );
}
