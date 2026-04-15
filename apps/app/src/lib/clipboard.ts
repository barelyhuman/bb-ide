import { toast } from "sonner";

interface CopyToClipboardOptions {
  /** Toast message shown on success (set to `null` to suppress). */
  successMessage?: string | null;
  /** Toast message shown on failure (set to `null` to suppress). */
  errorMessage?: string | null;
}

/**
 * Copies text to the clipboard and surfaces success/failure via toast.
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
    if (errorMessage) toast.error(errorMessage);
    return false;
  }
  try {
    await navigator.clipboard.writeText(text);
    if (successMessage) toast.success(successMessage);
    return true;
  } catch {
    if (errorMessage) toast.error(errorMessage);
    return false;
  }
}
