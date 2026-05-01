import type { ViewTaskStatus } from "@bb/domain";

export function taskStatusGlyph(status: ViewTaskStatus): string {
  switch (status) {
    case "completed":
      return "☒";
    case "active":
      return "◼";
    case "failed":
      return "⚠";
    case "pending":
      return "□";
  }
}
