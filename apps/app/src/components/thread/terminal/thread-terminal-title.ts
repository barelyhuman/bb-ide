const TERMINAL_TITLE_MAX_LENGTH = 200;
const TERMINAL_TITLE_PATH_SEGMENT_COUNT = 3;

interface NormalizeTerminalTitleArgs {
  title: string;
}

interface FormatTerminalPathTitleArgs {
  path: string;
}

interface IsPathLikeTerminalTitlePathArgs {
  path: string;
}

interface ParseShellPathTitleArgs {
  title: string;
}

interface ShellPathTitleParts {
  path: string;
}

type NormalizedTerminalTitle = string | null;

export function normalizeTerminalTitle({
  title,
}: NormalizeTerminalTitleArgs): NormalizedTerminalTitle {
  const trimmedTitle = title.trim();
  if (!trimmedTitle) {
    return null;
  }

  const pathTitle = parseShellPathTitle({ title: trimmedTitle });
  if (pathTitle !== null) {
    return formatTerminalPathTitle({
      path: pathTitle.path,
    }).slice(0, TERMINAL_TITLE_MAX_LENGTH);
  }

  return trimmedTitle.slice(0, TERMINAL_TITLE_MAX_LENGTH);
}

function parseShellPathTitle({
  title,
}: ParseShellPathTitleArgs): ShellPathTitleParts | null {
  const match = /^[^@\s:]+@[^:\s]+:(.+)$/u.exec(title);
  const path = match?.[1];
  if (!path || !isPathLikeTerminalTitlePath({ path })) {
    return null;
  }
  return { path };
}

function isPathLikeTerminalTitlePath({
  path,
}: IsPathLikeTerminalTitlePathArgs): boolean {
  return (
    path === "~" ||
    path === "." ||
    path.startsWith("~/") ||
    path.startsWith("/") ||
    path.startsWith("./")
  );
}

function formatTerminalPathTitle({
  path,
}: FormatTerminalPathTitleArgs): string {
  if (path === "/" || path === "~" || path === ".") {
    return path;
  }

  const segments = path.split("/").filter((segment) => segment.length > 0);
  if (segments.length <= TERMINAL_TITLE_PATH_SEGMENT_COUNT) {
    return path;
  }

  return `.../${segments.slice(-TERMINAL_TITLE_PATH_SEGMENT_COUNT).join("/")}`;
}
