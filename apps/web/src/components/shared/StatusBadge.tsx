import type { ThreadStatus } from "@beanbag/core";
import { Badge } from "@/components/ui/badge";

type Status = ThreadStatus;

const variantMap: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  active: "default",
  idle: "outline",
};

export function StatusBadge({ status }: { status: Status }) {
  const variant = variantMap[status] ?? "outline";

  return (
    <Badge variant={variant} className="text-[11px] capitalize">
      {status}
    </Badge>
  );
}
