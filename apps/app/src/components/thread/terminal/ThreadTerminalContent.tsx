import {
  terminalStatusLabel,
  type ThreadTerminalController,
} from "./useThreadTerminalController";
import { ThreadTerminalView } from "./ThreadTerminalView";

interface ThreadTerminalContentProps {
  controller: ThreadTerminalController;
}

export function ThreadTerminalContent({
  controller,
}: ThreadTerminalContentProps) {
  if (controller.hasTerminalQueryError) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-destructive">
        Failed to load terminals.
      </div>
    );
  }

  if (!controller.activeSession) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        {controller.terminalBodyMessage}
      </div>
    );
  }

  if (controller.activeSession.status !== "running") {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-muted-foreground">
        Terminal {terminalStatusLabel(controller.activeSession)}.
      </div>
    );
  }

  return (
    <ThreadTerminalView
      isPanelOpen={controller.isPanelOpen}
      onTitleChange={controller.handleActiveTerminalTitleChange}
      onUserInput={controller.handleActiveTerminalUserInput}
      session={controller.activeSession}
      threadId={controller.threadId}
    />
  );
}
