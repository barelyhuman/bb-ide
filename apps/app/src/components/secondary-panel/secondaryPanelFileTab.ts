import type { ReactNode } from "react";
/**
 * A single closable tab rendered in the right panel's scrolling tab strip.
 */
export interface SecondaryPanelFileTab {
  id: string;
  filename: string;
  isActive: boolean;
  isPinned?: boolean;
  leadingVisual: ReactNode;
  statusLabel: string | null;
  onSelect: () => void;
  onClose: () => void;
}
