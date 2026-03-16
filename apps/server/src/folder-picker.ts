import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function normalizePickedPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) {
    return null;
  }

  // Keep POSIX root and Windows drive roots intact.
  if (trimmed === "/" || /^[A-Za-z]:[\\/]$/.test(trimmed)) {
    return trimmed.replace(/\\/g, "/");
  }

  return trimmed.replace(/\\/g, "/").replace(/[\\/]+$/, "");
}

function isCancellationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const withError = error as { code?: number | string; message?: string; stderr?: string };
  const message = `${withError.message ?? ""}\n${withError.stderr ?? ""}`.toLowerCase();

  return (
    withError.code === 1 ||
    message.includes("user canceled") ||
    message.includes("user cancelled") ||
    message.includes("error number -128")
  );
}

async function pickFolderPathDarwin(): Promise<string | null> {
  const { stdout } = await execFileAsync("osascript", [
    "-e",
    'set selectedFolder to choose folder with prompt "Select project folder"',
    "-e",
    "POSIX path of selectedFolder",
  ]);
  return normalizePickedPath(stdout);
}

async function pickFolderPathWindows(): Promise<string | null> {
  const { stdout } = await execFileAsync("powershell", [
    "-NoProfile",
    "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; $dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = 'Select project folder'; if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }",
  ]);
  return normalizePickedPath(stdout);
}

async function pickFolderPathLinux(): Promise<string | null> {
  const { stdout } = await execFileAsync("zenity", [
    "--file-selection",
    "--directory",
    "--title=Select project folder",
  ]);
  return normalizePickedPath(stdout);
}

export async function pickFolderPath(): Promise<string | null> {
  try {
    switch (process.platform) {
      case "darwin":
        return await pickFolderPathDarwin();
      case "win32":
        return await pickFolderPathWindows();
      case "linux":
        return await pickFolderPathLinux();
      default:
        throw new Error(`Unsupported platform: ${process.platform}`);
    }
  } catch (error) {
    if (isCancellationError(error)) {
      return null;
    }
    throw error;
  }
}
