export type ShareResult = "shared" | "copied" | "downloaded" | "cancelled" | "failed";

export interface ShareCapabilities {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  copy?: (text: string) => Promise<void>;
  download?: (file: File) => void;
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" :
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Calls native share before the first await, preserving the tap's user activation. */
export async function shareWorkout(text: string, file: File | undefined, capabilities: ShareCapabilities): Promise<ShareResult> {
  if (capabilities.share) {
    let filesSupported = false;
    try { filesSupported = Boolean(file && capabilities.canShare?.({ files: [file] })); }
    catch { filesSupported = false; }
    if (file && filesSupported) {
      try { await capabilities.share({ files: [file], text }); return "shared"; }
      catch (error) { if (cancelled(error)) return "cancelled"; }
    }
    try { await capabilities.share({ text }); return "shared"; }
    catch (error) { if (cancelled(error)) return "cancelled"; }
  }
  if (capabilities.copy) {
    try { await capabilities.copy(text); return "copied"; }
    catch { /* Continue to the image fallback. */ }
  }
  if (file && capabilities.download) {
    try { capabilities.download(file); return "downloaded"; }
    catch { /* Give the user the selectable message instead. */ }
  }
  return "failed";
}

export function downloadShareCard(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
