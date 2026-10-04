export type ShareResult = "sharedImage" | "sharedImageOnly" | "sharedText" | "imageFailed" | "cancelled" | "unsupported" | "failed";

export interface ShareCapabilities {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException ? error.name === "AbortError" :
    typeof error === "object" && error !== null && "name" in error && error.name === "AbortError";
}

/** Exactly one native share call per tap: a failed share consumes transient activation. */
export async function shareWorkout(text: string, file: File | undefined, capabilities: ShareCapabilities): Promise<ShareResult> {
  if (!capabilities.share) return "unsupported";
  let imagePayload: ShareData | undefined;
  if (file && file.size > 0 && file.type === "image/png") {
    try { if (capabilities.canShare?.({ files: [file], text })) imagePayload = { files: [file], text }; }
    catch { /* File-only capability may still work. */ }
    if (!imagePayload) try { if (capabilities.canShare?.({ files: [file] })) imagePayload = { files: [file] }; }
    catch { /* Use text-only sharing below. */ }
  }
  if (imagePayload) {
    try { await capabilities.share(imagePayload); return imagePayload.text === undefined ? "sharedImageOnly" : "sharedImage"; }
    catch (error) { return cancelled(error) ? "cancelled" : "imageFailed"; }
  }
  try { await capabilities.share({ text }); return "sharedText"; }
  catch (error) { return cancelled(error) ? "cancelled" : "failed"; }
}
