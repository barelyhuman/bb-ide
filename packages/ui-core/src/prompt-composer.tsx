import type { ReactNode } from "react";
import { cx } from "./utils.js";

export interface PromptComposerShellProps {
  children: ReactNode;
  statusLabel?: string;
  className?: string;
}

export function PromptComposerShell({
  children,
  statusLabel,
  className,
}: PromptComposerShellProps) {
  return (
    <div className={cx("space-y-2", className)}>
      {statusLabel ? (
        <div className="text-xs text-muted-foreground">{statusLabel}</div>
      ) : null}
      {children}
    </div>
  );
}
