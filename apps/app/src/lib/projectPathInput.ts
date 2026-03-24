export function deriveProjectNameFromPath(path: string): string {
  if (!path || path === "/") {
    return "";
  }

  const segments = path.split("/").filter(Boolean);
  return segments.at(-1) ?? "";
}
