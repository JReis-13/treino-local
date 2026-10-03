export type ShareResult = "shared" | "cancelled" | "unsupported" | "failed";

export interface ShareCapabilities {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" :
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Calls native share before the first await, preserving the tap's user activation. */
export async function shareWorkout(text: string, file: File | undefined, capabilities: ShareCapabilities): Promise<ShareResult> {
  if (!capabilities.share) return "unsupported";
  let filesSupported = false;
  try { filesSupported = Boolean(file && capabilities.canShare?.({ files: [file] })); }
  catch { filesSupported = false; }
  if (file && filesSupported) {
    try { await capabilities.share({ files: [file], text }); return "shared"; }
    catch (error) { if (cancelled(error)) return "cancelled"; }
  }
  try { await capabilities.share({ text }); return "shared"; }
  catch (error) { return cancelled(error) ? "cancelled" : "failed"; }
}
