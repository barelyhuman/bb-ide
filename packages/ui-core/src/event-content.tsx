import type { ReactNode } from "react";
import { cx } from "./utils.js";

const EVENT_META_GRID_CLASS =
  "grid grid-cols-[92px_minmax(0,1fr)] gap-2 text-sm sm:grid-cols-[124px_minmax(0,1fr)]";

export interface EventMetaListProps {
  children: ReactNode;
  className?: string;
}

export function EventMetaList({ children, className }: EventMetaListProps) {
  return (
    <dl
      className={cx(
        "rounded-md border border-border/60 bg-background/50 px-2 py-1",
        className,
      )}
    >
      {children}
    </dl>
  );
}

export interface EventMetaItemProps {
  label: ReactNode;
  children: ReactNode;
  className?: string;
  labelClassName?: string;
  valueClassName?: string;
  align?: "start" | "center";
}

export function EventMetaItem({
  label,
  children,
  className,
  labelClassName,
  valueClassName,
  align = "center",
}: EventMetaItemProps) {
  return (
    <div
      className={cx(
        EVENT_META_GRID_CLASS,
        align === "center" ? "items-center py-1" : "py-1",
        className,
      )}
    >
      <dt className={cx("text-xs text-muted-foreground", labelClassName)}>{label}</dt>
      <dd className={cx("min-w-0", valueClassName)}>{children}</dd>
    </div>
  );
}

export interface EventCodeBlockProps {
  children: ReactNode;
  className?: string;
  maxHeightClassName?: string;
  tone?: "default" | "danger";
}

export function EventCodeBlock({
  children,
  className,
  maxHeightClassName,
  tone = "default",
}: EventCodeBlockProps) {
  return (
    <pre
      className={cx(
        "overflow-auto whitespace-pre-wrap break-words rounded-md px-2 py-1.5 font-mono ui-text-xs leading-tight",
        maxHeightClassName,
        tone === "danger"
          ? "text-destructive/90"
          : "border border-border/70 bg-background/70 text-muted-foreground",
        className,
      )}
    >
      {children}
    </pre>
  );
}
