import type { TaskStatus } from "@beanbag/core";
import { Badge } from "@/components/ui/badge";

const variantMap: Record<
  TaskStatus,
  "default" | "secondary" | "destructive" | "outline"
> = {
  open: "outline",
  in_progress: "default",
  blocked: "destructive",
  closed: "secondary",
};

export function TaskStatusBadge({ status }: { status: TaskStatus }) {
  return (
    <Badge variant={variantMap[status]} className="text-[11px]">
      {status.replace("_", " ")}
    </Badge>
  );
}
