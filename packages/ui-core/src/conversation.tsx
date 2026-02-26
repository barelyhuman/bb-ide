import type { ReactNode } from "react";
import { cx } from "./utils.js";

export interface ConversationTimelineProps {
  children: ReactNode;
  className?: string;
}

export function ConversationTimeline({
  children,
  className,
}: ConversationTimelineProps) {
  return <div className={cx("flex min-w-0 flex-col gap-1", className)}>{children}</div>;
}

export interface ConversationEmptyStateProps {
  message: string;
  className?: string;
}

export function ConversationEmptyState({
  message,
  className,
}: ConversationEmptyStateProps) {
  return (
    <div className={cx("py-16 text-center text-sm text-muted-foreground", className)}>
      {message}
    </div>
  );
}
