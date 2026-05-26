import { appToast } from "@/components/ui/app-toast";

interface CopyToClipboardOptions {
  /** Toast message shown on success (set to `null` to suppress). */
  successMessage?: string | null;
  /** Toast message shown on failure (set to `null` to suppress). */
  errorMessage?: string | null;
}

/**
 * Copies text to the clipboard and surfaces success/failure via appToast.
 * Returns `true` on success, `false` on failure.
 */
export async function copyToClipboardWithToast(
  text: string,
  {
    successMessage = "Copied",
    errorMessage = "Failed to copy",
  }: CopyToClipboardOptions = {},
): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    if (errorMessage) appToast.error(errorMessage);
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) appToast.success(successMessage);
    return true;
  } catch {
    if (errorMessage) appToast.error(errorMessage);
    return false;
  }
}
