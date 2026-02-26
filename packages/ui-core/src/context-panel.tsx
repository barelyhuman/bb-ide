import type { ReactNode } from "react";
import { cx } from "./utils.js";

export interface ContextPanelProps {
  children: ReactNode;
  className?: string;
}

export function ContextPanel({ children, className }: ContextPanelProps) {
  return <div className={cx("space-y-3 lg:sticky lg:top-2", className)}>{children}</div>;
}

export interface ContextPanelCardProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function ContextPanelCard({
  title,
  children,
  className,
}: ContextPanelCardProps) {
  return (
    <section
      className={cx(
        "rounded-lg border border-border/70 bg-card/40 px-3 py-2.5",
        className,
      )}
    >
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      <div className="space-y-1 text-sm">{children}</div>
    </section>
  );
}
