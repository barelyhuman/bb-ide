export function resolveWorkspaceAbsolutePath(
  workspaceRoot: string,
  relativePath: string,
): string {
  const normalizedRoot = workspaceRoot === "/"
    ? "/"
    : workspaceRoot.endsWith("/")
    ? workspaceRoot.slice(0, -1)
    : workspaceRoot;
  const normalizedPath = relativePath.startsWith("./")
    ? relativePath.slice(2)
    : relativePath;

  if (normalizedPath.startsWith("/")) {
    return normalizedPath;
  }

  if (normalizedRoot === "/") {
    return `/${normalizedPath}`;
  }

  return `${normalizedRoot}/${normalizedPath}`;
}
