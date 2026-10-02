import type { ImportedTraining } from "@/types/training";

async function post<T>(path: string, payload: Record<string, unknown>): Promise<T> {
  const response = await fetch(path, { method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Google request failed.");
  return body as T;
}
export async function googleStatus(): Promise<boolean> {
  const response = await fetch("/api/google/auth/status", { cache: "no-store" });
  const body = await response.json();
  return body.connected === true;
}
export function connectGoogle(returnTo: "/plans" | "/settings" | "/source" = "/plans") {
  // OAuth requires a top-level navigation through the server redirect, not an SPA transition.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/api/google/auth/start?returnTo=${encodeURIComponent(returnTo)}`);
}
export const disconnectGoogle = () => post<{ disconnected: boolean }>("/api/google/auth/disconnect", {});
export const importGoogleSheet = (url: string) => post<{ imported: ImportedTraining }>("/api/google/sheets/import", { url });
export const refreshGoogleSheet = (spreadsheetId: string, sourceFingerprint: string, sourceProof: string) =>
  post<{ imported: ImportedTraining }>("/api/google/sheets/refresh", { spreadsheetId, sourceFingerprint, sourceProof });
export const syncGoogleDate = (spreadsheetId: string, sourceFingerprint: string, sourceProof: string, workoutId: string, localDate: string) =>
  post<{ status: "synced" | "duplicate" | "full"; sourceSlot?: string }>("/api/google/sheets/register-completion",
    { spreadsheetId, sourceFingerprint, sourceProof, workoutId, localDate });
