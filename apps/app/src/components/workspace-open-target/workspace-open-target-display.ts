import type { WorkspaceOpenTargetId } from "@bb/host-daemon-contract";

const WORKSPACE_OPEN_TARGET_FALLBACK_LABELS: Record<
  WorkspaceOpenTargetId,
  string
> = {
  antigravity: "Antigravity",
  cursor: "Cursor",
  "default-app": "Default App",
  finder: "Finder",
  ghostty: "Ghostty",
  iterm2: "iTerm2",
  "sublime-text": "Sublime Text",
  terminal: "Terminal",
  vscode: "VS Code",
  windsurf: "Windsurf",
  xcode: "Xcode",
  zed: "Zed",
};

export function getWorkspaceOpenTargetFallbackLabel(
  targetId: WorkspaceOpenTargetId,
): string {
  return WORKSPACE_OPEN_TARGET_FALLBACK_LABELS[targetId];
}
