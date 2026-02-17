import type { TaskStatus } from "@beanbag/core";
import { formatSnakeCaseLabel } from "@/lib/formatting";
import { StatusPill, type StatusPillVariant } from "./StatusPill";

const variantMap: Record<TaskStatus, StatusPillVariant> = {
  open: "outline",
  in_progress: "default",
  blocked: "destructive",
  closed: "secondary",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return <StatusPill variant={variantMap[status]}>{formatSnakeCaseLabel(status)}</StatusPill>;
}
