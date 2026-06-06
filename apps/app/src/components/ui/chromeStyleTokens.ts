// Shared low-emphasis chrome tokens for section labels and icon-only chrome
// buttons. Keeping these as class tokens prevents menu/sidebar labels and
// top-nav icon controls from drifting into content-level emphasis.
export const CHROME_SECTION_LABEL_CLASS =
  "text-xs font-normal leading-5 text-subtle-foreground";

export const CHROME_SUBTLE_ICON_BUTTON_FOREGROUND_CLASS =
  "text-subtle-foreground hover:text-muted-foreground data-[state=open]:text-muted-foreground";
