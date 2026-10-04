export type ShareResult = "shared" | "cancelled" | "unsupported" | "failed";

export interface ShareCapabilities {
  share?: (data: ShareData) => Promise<void>;
}

/** Keep the native call in the original tap handler so it has user activation. */
export async function shareWorkout(text: string, capabilities: ShareCapabilities): Promise<ShareResult> {
  if (!capabilities.share) return "unsupported";
  try {
    await capabilities.share({ text });
    return "shared";
  } catch (error) {
    if (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError") return "cancelled";
    return "failed";
  }
}
