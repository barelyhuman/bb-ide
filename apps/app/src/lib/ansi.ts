import Convert from "ansi-to-html";

const DARK_COLORS: Record<number, string> = {
  0: "#858585",
  1: "#d85e5e",
  2: "#0dbc79",
  3: "#e5e510",
  4: "#3c88dc",
  5: "#c85ac8",
  6: "#11a8cd",
  7: "#e5e5e5",
  8: "#9a9a9a",
  9: "#ff6f6f",
  10: "#23d18b",
  11: "#f5f543",
  12: "#5aaaf2",
  13: "#d670d6",
  14: "#29b8db",
  15: "#ffffff",
};

const LIGHT_COLORS: Record<number, string> = {
  0: "#000000",
  1: "#a11616",
  2: "#13704a",
  3: "#7f6a00",
  4: "#1f5ca6",
  5: "#8a2f8a",
  6: "#0b6f88",
  7: "#3d3d3d",
  8: "#3a3a3a",
  9: "#d32f2f",
  10: "#197c52",
  11: "#a35f00",
  12: "#2666b0",
  13: "#9b349b",
  14: "#0f7798",
  15: "#1f1f1f",
};

function getThemeMode(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/**
 * Converts ANSI escape codes to safe HTML.
 */
export function ansiToHtml(text: string): string {
  const theme = getThemeMode();
  const converter = new Convert({
    fg: "currentColor",
    bg: "transparent",
    newline: false,
    escapeXML: true,
    stream: false,
    colors: theme === "dark" ? DARK_COLORS : LIGHT_COLORS,
  });
  return converter.toHtml(text);
}
