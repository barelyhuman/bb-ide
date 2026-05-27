export interface MarkdownPreviewLocalFileLink {
  lineNumber: number | null;
  /**
   * Absolute local path. Callers own workspace containment checks so
   * MarkdownPreview can stay reusable.
   */
  path: string;
}

/**
 * Return `true` when the link was handled and anchor navigation should be
 * prevented. Return `false` to leave the link as a normal anchor.
 */
export type MarkdownPreviewLocalFileLinkHandler = (
  link: MarkdownPreviewLocalFileLink,
) => boolean;

interface LocalFileHrefParts {
  lineNumber: number | null;
  path: string;
}

interface LocalFilePathValidationArgs {
  requireLikelyFileBasename: boolean;
  path: string;
}

function safeDecodeURIComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function parsePositiveInteger(value: string): number | null {
  if (!/^[0-9]+$/u.test(value)) {
    return null;
  }
  const parsedValue = Number(value);
  return Number.isSafeInteger(parsedValue) && parsedValue > 0
    ? parsedValue
    : null;
}

function parseLineSuffix(value: string): LocalFileHrefParts | null {
  const hashLineMatch = value.match(/#L([0-9]+)$/u);
  if (hashLineMatch) {
    const lineNumber = parsePositiveInteger(hashLineMatch[1] ?? "");
    if (lineNumber === null) {
      return null;
    }

    return {
      lineNumber,
      path: value.slice(0, hashLineMatch.index),
    };
  }

  const hashIndex = value.indexOf("#");
  if (hashIndex !== -1) {
    const fragment = value.slice(hashIndex + 1);
    if (
      fragment.length === 0 ||
      fragment.includes("/") ||
      fragment.includes("#")
    ) {
      return null;
    }

    return {
      lineNumber: null,
      path: value.slice(0, hashIndex),
    };
  }

  const colonLineColumnMatch = value.match(/:([0-9]+):[0-9]+$/u);
  if (colonLineColumnMatch) {
    const lineNumber = parsePositiveInteger(colonLineColumnMatch[1] ?? "");
    if (lineNumber === null) {
      return null;
    }

    return {
      lineNumber,
      path: value.slice(0, colonLineColumnMatch.index),
    };
  }

  const colonLineMatch = value.match(/:([0-9]+)$/u);
  if (colonLineMatch) {
    const lineNumber = parsePositiveInteger(colonLineMatch[1] ?? "");
    if (lineNumber === null) {
      return null;
    }

    return {
      lineNumber,
      path: value.slice(0, colonLineMatch.index),
    };
  }

  return {
    lineNumber: null,
    path: value,
  };
}

function hasLikelyFileBasename(path: string): boolean {
  const segments = path.split("/");
  const basename = segments[segments.length - 1] ?? "";
  return basename.startsWith(".") || basename.includes(".");
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint < 0x20) {
      return true;
    }
  }

  return false;
}

function isValidAbsoluteLocalFilePath({
  path,
  requireLikelyFileBasename,
}: LocalFilePathValidationArgs): boolean {
  return (
    path.startsWith("/") &&
    !path.startsWith("//") &&
    path !== "/" &&
    !path.endsWith("/") &&
    !path.includes("\n") &&
    !path.includes("\r") &&
    !path.includes("?") &&
    !path.includes("#") &&
    !hasControlCharacter(path) &&
    (!requireLikelyFileBasename || hasLikelyFileBasename(path))
  );
}

function parseAbsoluteLocalFileHref(
  href: string,
  requireLikelyFileBasename: boolean,
): MarkdownPreviewLocalFileLink | null {
  if (
    href.length === 0 ||
    href.trim() !== href ||
    !href.startsWith("/") ||
    href.startsWith("//")
  ) {
    return null;
  }

  const parsed = parseLineSuffix(safeDecodeURIComponent(href));
  if (
    !parsed ||
    !isValidAbsoluteLocalFilePath({
      path: parsed.path,
      requireLikelyFileBasename,
    })
  ) {
    return null;
  }

  return parsed;
}

export function parseLocalFileHref(
  href: string | undefined,
): MarkdownPreviewLocalFileLink | null {
  if (!href) {
    return null;
  }

  if (href.startsWith("file://")) {
    try {
      const url = new URL(href);
      if (url.host.length > 0) {
        return null;
      }
      if (url.search.length > 0) {
        return null;
      }
      return parseAbsoluteLocalFileHref(url.pathname + url.hash, false);
    } catch {
      return null;
    }
  }

  return parseAbsoluteLocalFileHref(href, true);
}

function encodeFileUrlPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function parseLocalFileHrefFragment(href: string | undefined): string | null {
  if (!href) {
    return null;
  }

  let hash: string;
  if (href.startsWith("file://")) {
    try {
      hash = new URL(href).hash;
    } catch {
      return null;
    }
  } else {
    const hashIndex = href.indexOf("#");
    if (hashIndex === -1) {
      return null;
    }
    hash = href.slice(hashIndex);
  }

  const decodedHash = safeDecodeURIComponent(hash);
  if (
    decodedHash.length <= 1 ||
    /^#L[0-9]+$/u.test(decodedHash) ||
    decodedHash.includes("\n") ||
    decodedHash.includes("\r")
  ) {
    return null;
  }

  return decodedHash.slice(1);
}

function encodeFileUrlFragment(fragment: string): string {
  return encodeURIComponent(fragment);
}

export function buildLocalFileAnchorHref(
  link: MarkdownPreviewLocalFileLink | null,
  originalHref: string | undefined,
): string | undefined {
  if (!link || !link.path.startsWith("/")) {
    return originalHref;
  }

  const fragment =
    link.lineNumber === null ? parseLocalFileHrefFragment(originalHref) : null;
  return `file://${encodeFileUrlPath(link.path)}${
    link.lineNumber !== null
      ? `#L${link.lineNumber}`
      : fragment === null
        ? ""
        : `#${encodeFileUrlFragment(fragment)}`
  }`;
}
