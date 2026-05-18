import { Button } from "@/components/ui/button.js";
import { Icon } from "@/components/ui/icon.js";
import { ThreadTerminalContent } from "./ThreadTerminalContent";
import { ThreadTerminalTabStrip } from "./ThreadTerminalTabStrip";
import { useThreadTerminalController } from "./useThreadTerminalController";

interface ThreadTerminalPanelProps {
  canCreateTerminal: boolean;
  threadId: string;
}

export function ThreadTerminalPanel({
  canCreateTerminal,
  threadId,
}: ThreadTerminalPanelProps) {
  const terminalController = useThreadTerminalController({
    canCreateTerminal,
    threadId,
  });

  return (
    <section
      aria-label="Thread terminals"
      className="flex h-full min-h-0 min-w-0 flex-col bg-background"
    >
      <div className="flex h-10 min-h-10 items-center gap-2 bg-background px-3">
        <ThreadTerminalTabStrip controller={terminalController} />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 rounded-md p-0 text-muted-foreground"
          onClick={terminalController.handleClosePanel}
          aria-label="Close terminal panel"
          title="Close terminal panel"
        >
          <Icon name="X" className="size-3.5" />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-background">
        <ThreadTerminalContent controller={terminalController} />
      </div>
    </section>
  );
}
