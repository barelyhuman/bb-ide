import Convert from "ansi-to-html";

const ANSI_COLORS: Record<number, string> = {
  0: "var(--ansi-0)",
  1: "var(--ansi-1)",
  2: "var(--ansi-2)",
  3: "var(--ansi-3)",
  4: "var(--ansi-4)",
  5: "var(--ansi-5)",
  6: "var(--ansi-6)",
  7: "var(--ansi-7)",
  8: "var(--ansi-8)",
  9: "var(--ansi-9)",
  10: "var(--ansi-10)",
  11: "var(--ansi-11)",
  12: "var(--ansi-12)",
  13: "var(--ansi-13)",
  14: "var(--ansi-14)",
  15: "var(--ansi-15)",
};

/**
 * Converts ANSI escape codes to safe HTML.
 */
export function ansiToHtml(text: string): string {
  const converter = new Convert({
    fg: "var(--foreground)",
    bg: "var(--background)",
    newline: false,
    escapeXML: true,
    stream: false,
    colors: ANSI_COLORS,
  });
  return converter.toHtml(text);
}
